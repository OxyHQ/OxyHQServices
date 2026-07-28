import {
  logger as loggerUtil,
  runSessionColdBoot,
  type AuthStateStore,
  type IdentityBinding,
  type OxyServices,
  type SessionMode,
} from '@oxyhq/core';
import type { SessionClient } from '@oxyhq/core';
import { loadPersistedDeviceCredential } from '../utils/deviceCredential';
import {
  consumeSilentOAuthError,
  isSilentRestoreEligibleOrigin,
  maybeStartSilentOAuthRestore,
} from '../utils/crossOriginRestore';
import { tryCompleteOAuthReturn, consumeHubSyncFailure } from '../utils/oauthReturn';
import { isWebBrowser } from '../utils/isWebBrowser';
import { isNetConnectivityExplicitlyOffline } from '../utils/netConnectivity';
import { allowsAutomaticIdpRedirect } from '../oauth/legacyRedirectLanes';
import type { WebAuthMode } from '../oauth/types';
import type { CommitInput } from '../context/oxyContextTypes';

/** How long the cold boot waits for the post-boot SessionClient handoff (ms). */
export const SESSION_HANDOFF_DEADLINE_MS = 6000;

/**
 * HARD overall deadline (ms) for the whole `runSessionColdBoot` step chain.
 *
 * Bounds time-to-route: routing gates on `isAuthResolved`, which resolves when
 * the cold boot finishes, so a network step that never settles (a black-hole
 * network that neither connects nor rejects) would otherwise hang routing
 * indefinitely. 12s comfortably exceeds the healthy worst case of the
 * sequential, single-attempt (`retry:false`), 5s-capped network steps, so it is
 * INERT on healthy loads and only trips on a pathological network. Offline
 * devices short-circuit far sooner via the connectivity hint below.
 */
export const COLD_BOOT_OVERALL_DEADLINE_MS = 12_000;

/**
 * Timeout (ms) for the best-effort native connectivity probe. Kept tight so the
 * probe never itself adds meaningful latency to a healthy boot — an unknown
 * result within this window is treated as "online".
 */
const OFFLINE_PROBE_TIMEOUT_MS = 500;

/**
 * Best-effort, FAST connectivity probe run once before the cold boot.
 *
 * Returns `true` ONLY on an EXPLICIT disconnected verdict; every ambiguous
 * outcome (probe timeout, unknown/`null` state, NetInfo unavailable, a thrown
 * error) resolves to `false` (assume online) so a flaky probe can never falsely
 * skip a real sign-in. Never rejects. On web it reads `navigator.onLine`; on
 * native it races `NetInfo.fetch()` against {@link OFFLINE_PROBE_TIMEOUT_MS},
 * mirroring the existing NetInfo dynamic-import pattern in `OxyProvider`.
 */
async function detectOfflineHint(): Promise<boolean> {
  try {
    if (isWebBrowser()) {
      const online = (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine;
      // Only an explicit `false` is an offline verdict; `undefined` ⇒ assume online.
      return online === false;
    }
    const NetInfo = await import('@react-native-community/netinfo');
    const state = await Promise.race([
      NetInfo.default.fetch(),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), OFFLINE_PROBE_TIMEOUT_MS);
      }),
    ]);
    // `null` ⇒ the probe timed out (unknown → assume online). Only an explicit
    // disconnected / unreachable verdict disables the network steps.
    return isNetConnectivityExplicitlyOffline(state);
  } catch {
    // NetInfo missing / probe threw — never block sign-in on a probe failure.
    return false;
  }
}

export interface RunProviderColdBootOptions {
  oxyServices: OxyServices;
  authStore: AuthStateStore;
  clientId?: string;
  authRedirectUri?: string;
  /**
   * Authorize endpoint override for silent cross-origin restore. Defaults to
   * the production Oxy IdP when unset; a local/staging deployment sets it so the
   * silent-restore redirect targets its own IdP, never production.
   */
  authorizeBaseUrl?: string;
  /**
   * Who owns the session this boot resolves. `'account'` (the default) is the
   * device's active account — every ordinary Oxy app. `'identity'` binds the
   * boot to the owner of this device's PRIMARY identity key and REQUIRES
   * {@link identity}; it also disables the two web OAuth lanes below, which
   * commit whatever account the IdP hands back.
   */
  sessionMode?: SessionMode;
  /** The identity binding required by `sessionMode: 'identity'`. */
  identity?: IdentityBinding;
  /**
   * How this provider's WEB sign-in reaches the IdP
   * (`OxyProviderProps.webAuthMode`).
   *
   * A first-class INPUT to the boot, not a UI-only concern: `'popup'` forbids
   * the automatic full-page `prompt=none` restore in step 3, so a domain with no
   * local credential resolves SIGNED OUT instead of bouncing the top-level
   * window to `auth.oxy.so`. See `allowsAutomaticIdpRedirect`.
   * @default 'redirect'
   */
  webAuthMode?: WebAuthMode;
  sessionClient: SessionClient;
  syncDeviceCredentialToHost: () => Promise<void>;
  commitSession: (
    input: CommitInput,
    options: { activate: boolean; hubSync?: boolean },
  ) => Promise<void>;
  markAuthResolved: () => void;
  setTokenReady: (ready: boolean) => void;
}

/**
 * Device-first cold boot for `@oxyhq/services` providers.
 *
 * Ordered pipeline:
 * 1. Complete OAuth authorization-code return (web)
 * 2. `runSessionColdBoot` — device-secret mint (+ native shared-key, or the
 *    primary-identity-key lane in `sessionMode: 'identity'`)
 * 3. Silent OAuth for all web apps when mint finds no session
 *
 * Steps 1 and 3 are ACCOUNT-MODE ONLY: both commit whichever account the IdP
 * resolves, which for an identity-bound client is somebody else's account by
 * construction. In `'identity'` mode the boot is exactly step 2.
 *
 * Step 3 is additionally REDIRECT-MODE ONLY: it navigates the top-level window
 * with no user gesture behind it, which `webAuthMode: 'popup'` exists to
 * eliminate. In popup mode the boot is steps 1 and 2, and a domain with no local
 * credential simply resolves signed out. See `allowsAutomaticIdpRedirect`.
 */
export async function runProviderColdBoot(opts: RunProviderColdBootOptions): Promise<void> {
  const {
    oxyServices,
    authStore,
    clientId,
    authRedirectUri,
    authorizeBaseUrl,
    sessionMode = 'account',
    identity,
    webAuthMode = 'redirect',
    sessionClient,
    syncDeviceCredentialToHost,
    commitSession,
    markAuthResolved,
    setTokenReady,
  } = opts;

  const identityBound = sessionMode === 'identity';

  setTokenReady(false);

  try {
    // MODE-INDEPENDENT URL cleanup, deliberately so: both consume query params a
    // PREVIOUS redirect-mode session left in the address bar (`?error=login_required`
    // from a silent authorize, `?hub_sync=failed` from the hub) and restore the
    // page the visit started on. Flipping an app to popup mode must not strand
    // those params, so neither is gated on `webAuthMode`. Neither starts a
    // navigation — they only rewrite the URL via `history.replaceState`.
    consumeSilentOAuthError();
    consumeHubSyncFailure();

    // The redirect transport's RETURN leg — also NOT gated on `webAuthMode`. A
    // popup-mode app legitimately lands here with `?code=` whenever the browser
    // blocked the popup and `startWebOAuthSignIn` fell back to a full-page
    // redirect (`popup-blocked` / `popup-navigation-failed`), and an app that
    // switched modes mid-flight must not be stranded with a dead `?code=`
    // either. It consumes a code already on the URL; it never starts one.
    const oauthCompleted = identityBound
      ? false
      : await tryCompleteOAuthReturn({
          oxyServices,
          clientId,
          authRedirectUri,
          commitSession: (input) => commitSession(input, { activate: true, hubSync: false }),
        });
    if (oauthCompleted) {
      setTokenReady(true);
      markAuthResolved();
      return;
    }

    // Best-effort connectivity probe up front: an EXPLICIT offline verdict skips
    // the two doomed network steps so routing settles immediately instead of
    // burning the overall deadline on a mint that cannot succeed. Any ambiguity
    // resolves to "online" — the network steps still run.
    const offline = await detectOfflineHint();

    const outcome = await runSessionColdBoot({
      oxy: oxyServices,
      store: authStore,
      platform: { isWeb: isWebBrowser(), isNative: !isWebBrowser() },
      sessionMode,
      identity,
      overallDeadlineMs: COLD_BOOT_OVERALL_DEADLINE_MS,
      isOffline: () => offline,
      onStepDeadline: (stepId) => {
        loggerUtil.warn(
          `Cold-boot step "${stepId}" exceeded the ${COLD_BOOT_OVERALL_DEADLINE_MS}ms overall deadline — abandoned; routing proceeds signed-out`,
          { component: 'runProviderColdBoot', method: 'onStepDeadline' },
        );
      },
      onSession: async (session) => {
        // Mint already persisted `{deviceId, deviceSecret}` to the store; sync the
        // in-memory SessionClient host so sockets + tab-focus re-mint can use it.
        await syncDeviceCredentialToHost();
        const handoff = commitSession(
          {
            sessionId: session.sessionId,
            accessToken: session.accessToken,
            userId: session.userId,
          },
          { activate: false },
        );
        let handoffDeadlineId: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          handoff,
          new Promise<void>((resolve) => {
            handoffDeadlineId = setTimeout(resolve, SESSION_HANDOFF_DEADLINE_MS);
          }),
        ]).finally(() => {
          if (handoffDeadlineId !== undefined) {
            clearTimeout(handoffDeadlineId);
          }
        });
        markAuthResolved();
      },
      onSignedOut: async () => {
        await syncDeviceCredentialToHost();
        const cred = await loadPersistedDeviceCredential(authStore);
        if (cred) {
          try {
            await sessionClient.start();
          } catch (socketError) {
            if (__DEV__) {
              loggerUtil.debug(
                'Device socket start failed (non-fatal)',
                { component: 'runProviderColdBoot' },
                socketError,
              );
            }
          }
        }
        markAuthResolved();
      },
      onStepError: (id, error) => {
        if (__DEV__) {
          loggerUtil.debug(
            `Cold-boot step "${id}" errored (non-fatal, falling through)`,
            { component: 'runProviderColdBoot' },
            error,
          );
        }
      },
    });

    // Silent cross-origin OAuth restore (web cross-app SSO): a full-page
    // `prompt=none` bounce to the IdP when the mint found no local session.
    //
    // TRANSPORT gate (`allowsAutomaticIdpRedirect`): `webAuthMode: 'popup'`
    // FORBIDS this lane. It navigates the top-level window with no user gesture
    // behind it, which is precisely what popup mode exists to eliminate — a
    // popup-mode domain without a local credential resolves signed out right
    // here and waits for the user's next explicit "Continue with Oxy" (issue
    // #691, "Cold boot and cross-domain behavior"). `'redirect'` — still the
    // default and the compatibility path — reaches this lane unchanged, and this
    // whole block disappears with the transport in phase 7b.
    //
    // ORIGIN gate: same as the hub-sync WRITE side (`syncHubAfterSignIn`) —
    // official web origins only, never the IdP hub itself, and — unlike the
    // write side — never a loopback / local-dev origin (which must not be
    // bounced to a hosted IdP on cold boot). The authorize endpoint is
    // env-configurable so a local/staging app targets its own IdP instead of
    // production.
    const webOrigin = isWebBrowser()
      ? (globalThis as { location?: Location }).location?.origin
      : undefined;
    if (
      !identityBound &&
      allowsAutomaticIdpRedirect(webAuthMode) &&
      clientId &&
      outcome.kind !== 'session' &&
      webOrigin &&
      isSilentRestoreEligibleOrigin(webOrigin)
    ) {
      const redirected = await maybeStartSilentOAuthRestore({
        oxyServices,
        clientId,
        redirectUri: authRedirectUri,
        authorizeBaseUrl,
      });
      if (redirected) {
        return;
      }
    }
  } catch (error) {
    if (__DEV__) {
      loggerUtil.error(
        'Cold boot error',
        error instanceof Error ? error : new Error(String(error)),
        { component: 'runProviderColdBoot' },
      );
    }
  } finally {
    markAuthResolved();
  }
}

