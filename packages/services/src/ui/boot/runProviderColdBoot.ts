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
  maybeStartSilentOAuthRestore,
} from '../utils/crossOriginRestore';
import { tryCompleteOAuthReturn } from '../utils/oauthReturn';
import { isWebBrowser } from '../utils/isWebBrowser';

/** How long the cold boot waits for the post-boot SessionClient handoff (ms). */
export const SESSION_HANDOFF_DEADLINE_MS = 6000;

export interface ColdBootCommitInput {
  sessionId: string;
  accessToken: string;
  userId: string;
  deviceId?: string;
  deviceSecret?: string;
  expiresAt?: string;
  user?: unknown;
}

export interface RunProviderColdBootOptions {
  oxyServices: OxyServices;
  authStore: AuthStateStore;
  clientId?: string;
  authRedirectUri?: string;
  sessionClient: SessionClient;
  syncDeviceCredentialToHost: () => Promise<void>;
  commitSession: (input: ColdBootCommitInput, options: { activate: boolean }) => Promise<void>;
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
    sessionClient,
    syncDeviceCredentialToHost,
    commitSession,
    markAuthResolved,
    setTokenReady,
  } = opts;

  setTokenReady(false);

  try {
    consumeSilentOAuthError();

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

    if (isWebBrowser() && clientId && outcome.kind !== 'session') {
      const redirected = await maybeStartSilentOAuthRestore({
        oxyServices,
        clientId,
        redirectUri: authRedirectUri,
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

