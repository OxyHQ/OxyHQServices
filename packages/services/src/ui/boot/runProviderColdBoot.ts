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

    const outcome = await runSessionColdBoot({
      oxy: oxyServices,
      store: authStore,
      platform: { isWeb: isWebBrowser(), isNative: !isWebBrowser() },
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

