import {
  logger as loggerUtil,
  runSessionColdBoot,
  type AuthStateStore,
  type OxyServices,
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
    // `isConnected === false` disables the network steps.
    return state?.isConnected === false;
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
 * 2. `runSessionColdBoot` — device-secret mint (+ native shared-key)
 * 3. Silent OAuth for all web apps when mint finds no session
 */
export async function runProviderColdBoot(opts: RunProviderColdBootOptions): Promise<void> {
  const {
    oxyServices,
    authStore,
    clientId,
    authRedirectUri,
    authorizeBaseUrl,
    sessionClient,
    syncDeviceCredentialToHost,
    commitSession,
    markAuthResolved,
    setTokenReady,
  } = opts;

  setTokenReady(false);

  try {
    consumeSilentOAuthError();
    consumeHubSyncFailure();

    const oauthCompleted = await tryCompleteOAuthReturn({
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

    // Silent cross-origin OAuth restore (web cross-app SSO). Gate it the SAME
    // way the hub-sync WRITE side (`syncHubAfterSignIn`) gates: official web
    // origins only, never the IdP hub itself, and — unlike the write side —
    // never a loopback / local-dev origin (which must not be bounced to a hosted
    // IdP on cold boot). The authorize endpoint is env-configurable so a
    // local/staging app targets its own IdP instead of production.
    const webOrigin = isWebBrowser()
      ? (globalThis as { location?: Location }).location?.origin
      : undefined;
    if (
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

