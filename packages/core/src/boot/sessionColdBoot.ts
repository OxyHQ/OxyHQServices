/**
 * Device-first session cold boot for every consumer.
 *
 * On a fresh page load / app launch this resolves the device's session in a
 * deterministic order, built on the pure `runColdBoot` primitive. It NEVER
 * redirects to a login page: an unresolved boot ends in a signed-out state that
 * the app renders with a "Sign in with Oxy" button.
 *
 * Ordered steps (first to yield a session wins):
 *   1. `device-secret-mint` (web + native) — the zero-cookie transport: when the
 *      origin persisted a `deviceId` + `deviceSecret`, mint a short access token
 *      with a single bearer-less POST to `/session/device/token` (no cookie, no
 *      navigation) and rotate the secret in-use.
 *   2. `shared-key-signin` (native) — re-mint from the shared-keychain identity.
 *   3. Signed out.
 *
 * ESM-safe (no `require()`); no react/react-native/expo imports.
 */
import { runColdBoot, type ColdBootOutcome, type ColdBootStep } from '../utils/coldBoot';
import { isNative as detectNative } from '../utils/platform';
import { extractErrorStatus } from '../utils/errorUtils';
import { logger } from '../utils/loggerUtils';
import type { OxyServices } from '../OxyServices';
import type { AuthStateStore, PersistedAuthState } from '../session/authStateStore';

/** The winning session shape a cold-boot step reports. */
export interface DeviceBootSession {
  sessionId: string;
  userId: string;
  accessToken: string;
}

/** Why a cold boot ended without a session. */
export type SignedOutReason = 'no_session' | 'error';

export interface RunSessionColdBootOptions {
  oxy: OxyServices;
  store: AuthStateStore;
  /** Platform hints; default derived from `@oxyhq/core`'s platform detection. */
  platform?: { isWeb?: boolean; isNative?: boolean };
  /** Invoked with the winning session (token already planted). */
  onSession?: (session: DeviceBootSession & { via: string }) => void | Promise<void>;
  /** Invoked when the boot ended signed out. */
  onSignedOut?: (reason: SignedOutReason) => void | Promise<void>;
  onStepError?: (id: string, error: unknown) => void;
}

/**
 * How a `mintFromDeviceSecret` call failed, distinguished so the cold boot can
 * react per the transport contract:
 *  - `invalid_secret` — the presented secret no longer matches (another tab/
 *    device rotated it, or theft divergence). Drop it and fall back.
 *  - `no_active_session` — the device is known but has no live session.
 *    Authoritative signed-out.
 *  - `transient` — network / 5xx. Keep the secret; a later attempt can succeed.
 *
 * The mint is bearer-less (`skipAuth`), so `HttpService` surfaces the server's
 * 401 body string (`invalid_device_secret` | `no_active_session`) as the thrown
 * error's `message`; any non-401 is transport/server failure.
 */
type MintFailure = 'invalid_secret' | 'no_active_session' | 'transient';

function classifyMintFailure(error: unknown): MintFailure {
  if (extractErrorStatus(error) === 401) {
    // Structural read (not `instanceof Error`): the thrown value can be a plain
    // ApiError-shaped object or come from another realm, where instanceof fails
    // and a `no_active_session` would be misread as a stale secret and dropped.
    const message = (error as { message?: unknown })?.message;
    return typeof message === 'string' && message.includes('no_active_session')
      ? 'no_active_session'
      : 'invalid_secret';
  }
  return 'transient';
}

/**
 * Run the device-first cold boot. Resolves to the `runColdBoot` outcome and, as
 * a side effect, invokes `onSession` (winning session, token already planted) or
 * `onSignedOut` (no session).
 */
export async function runSessionColdBoot(
  opts: RunSessionColdBootOptions,
): Promise<ColdBootOutcome<DeviceBootSession>> {
  const { oxy, store } = opts;
  const isNative = opts.platform?.isNative ?? detectNative();

  // Boot-local (not module-level) so it cannot leak across boots or break under
  // bundler re-evaluation.
  let signedOutReason: SignedOutReason = 'no_session';

  const steps: Array<ColdBootStep<DeviceBootSession>> = [];

  // 1. device-secret-mint (web + native) — the zero-cookie fast path. When the
  //    origin persisted a deviceId + deviceSecret, mint a short access token with
  //    a single bearer-less POST (no cookie, no navigation).
  steps.push({
    id: 'device-secret-mint',
    run: async () => {
      const persisted = await store.load();
      if (!persisted?.deviceId || !persisted?.deviceSecret) {
        return { kind: 'skip' };
      }
      try {
        const mint = await oxy.mintFromDeviceSecret(persisted.deviceId, persisted.deviceSecret);
        // Rotation-in-use anti-loss: persist the NEXT secret (+ refreshed warm
        // fields, + the server's authoritative active account) BEFORE planting
        // the minted access token, so a multi-tab race that rotates again can
        // never strand this tab with a superseded secret.
        const active = mint.state.accounts.find((a) => a.accountId === mint.state.activeAccountId);
        const next: PersistedAuthState = {
          ...persisted,
          deviceId: mint.state.deviceId,
          deviceSecret: mint.nextDeviceSecret,
          accessToken: mint.accessToken,
          expiresAt: mint.expiresAt,
          ...(active ? { sessionId: active.sessionId, userId: active.accountId } : {}),
        };
        await store.save(next);
        oxy.setTokens(mint.accessToken);
        return {
          kind: 'session',
          session: { sessionId: next.sessionId, userId: next.userId, accessToken: mint.accessToken },
        };
      } catch (error) {
        const failure = classifyMintFailure(error);
        if (failure === 'invalid_secret') {
          // Stale/diverged secret — drop it so the mint lane stops firing. On
          // native the shared-key step below can still recover; on web this ends
          // signed out. Setting it undefined drops the key on the store's JSON
          // serialization, and the mint guard treats undefined as absent.
          await store.save({ ...persisted, deviceSecret: undefined });
          return { kind: 'skip' };
        }
        if (failure === 'no_active_session') {
          // Device known, no live session — authoritative signed-out.
          signedOutReason = 'no_session';
          return { kind: 'skip' };
        }
        // Transient (network / 5xx): keep the secret; a later attempt can succeed.
        logger.debug(
          'device-secret mint failed (transient) — keeping secret',
          { component: 'sessionColdBoot', method: 'device-secret-mint' },
          error,
        );
        return { kind: 'skip' };
      }
    },
  });

  // 2. shared-key-signin (native) — re-mint from the shared identity.
  steps.push({
    id: 'shared-key-signin',
    enabled: () => isNative,
    run: async () => {
      const session = await oxy.signInWithSharedIdentity();
      if (!session?.accessToken) {
        return { kind: 'skip' };
      }
      // `verifyChallenge` mints a rotating deviceSecret; persist it so the next
      // boot can use the faster device-secret-mint lane (sockets + tab-focus
      // re-mint depend on the credential being in the store).
      if (session.deviceId && session.deviceSecret) {
        await store.save({
          sessionId: session.sessionId,
          userId: session.user.id,
          deviceId: session.deviceId,
          deviceSecret: session.deviceSecret,
          accessToken: session.accessToken,
          expiresAt: session.expiresAt,
        });
      }
      return {
        kind: 'session',
        session: {
          sessionId: session.sessionId,
          userId: session.user.id,
          accessToken: session.accessToken,
        },
      };
    },
  });

  const outcome = await runColdBoot<DeviceBootSession>({
    steps,
    onStepError: (id, error) => {
      signedOutReason = 'error';
      opts.onStepError?.(id, error);
    },
  });

  if (outcome.kind === 'session') {
    await opts.onSession?.({ ...outcome.session, via: outcome.via });
    return outcome;
  }

  await opts.onSignedOut?.(signedOutReason);
  return outcome;
}
