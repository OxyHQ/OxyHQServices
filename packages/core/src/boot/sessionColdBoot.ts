/**
 * Device-first session cold boot for every consumer.
 *
 * On a fresh page load / app launch this resolves the device's session in a
 * deterministic order, built on the pure `runColdBoot` primitive. It NEVER
 * redirects to a login page: an unresolved boot ends in a signed-out state that
 * the app renders with a "Sign in with Oxy" button.
 *
 * Ordered steps (first to yield a session wins):
 *   1. `warm-token-plant` (web + native) — the fastest path: when the persisted
 *      store still holds a warm access token that is valid for more than the
 *      refresh lead window, plant it and yield the session with NO network
 *      round-trip. The background scheduler rotates it shortly after.
 *   2. `device-secret-mint` (web + native) — the zero-cookie transport: when the
 *      origin persisted a `deviceId` + `deviceSecret`, mint a short access token
 *      with a single bearer-less POST to `/session/device/token` (no cookie, no
 *      navigation) and rotate the secret in-use.
 *   3. `shared-key-signin` (native) — re-mint from the shared-keychain identity.
 *   4. Signed out.
 *
 * ESM-safe (no `require()`); no react/react-native/expo imports.
 */
import { runColdBoot, type ColdBootOutcome, type ColdBootStep } from '../utils/coldBoot';
import { isNative as detectNative } from '../utils/platform';
import { logger } from '../logger';
import { TOKEN_REFRESH_LEAD_MS, refreshDeviceSecretArm } from '../session/refresh';
import type { OxyServices } from '../OxyServices';
import type { AuthStateStore } from '../session/authStateStore';

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

  // 1. warm-token-plant (web + native) — the fastest path. When the persisted
  //    store already holds a still-valid warm access token (its expiry more than
  //    the refresh lead window away) plus its owning session identity, plant it
  //    and yield the session IMMEDIATELY, skipping the blocking mint round-trip on
  //    first paint. The token is used AS-IS: this step NEVER mints, rotates, or
  //    persists anything. The proactive `startTokenRefreshScheduler` + the
  //    request-time preflight (both wired in the services provider) rotate it in
  //    the background; a revoked token self-heals via the 401 -> re-mint -> clear
  //    path. This exposure is sanctioned by `authStateStore.ts` (~L30-36): the
  //    warm token is short-lived and adds nothing over the already-persisted
  //    `deviceSecret`.
  steps.push({
    id: 'warm-token-plant',
    run: async () => {
      const persisted = await store.load();
      if (!persisted?.accessToken || !persisted.sessionId || !persisted.userId || !persisted.expiresAt) {
        return { kind: 'skip' };
      }
      // Guard a malformed `expiresAt` (Date.parse -> NaN): treat as not-valid and
      // fall through to the mint lane. A token still inside the refresh lead
      // window (or already expired) is likewise skipped — let the mint lane get a
      // fresh one rather than plant a token about to expire.
      const expiresAtMs = new Date(persisted.expiresAt).getTime();
      if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + TOKEN_REFRESH_LEAD_MS) {
        return { kind: 'skip' };
      }
      oxy.setTokens(persisted.accessToken);
      return {
        kind: 'session',
        session: {
          sessionId: persisted.sessionId,
          userId: persisted.userId,
          accessToken: persisted.accessToken,
        },
      };
    },
  });

  // 2. device-secret-mint (web + native) — the zero-cookie fast path. When the
  //    origin persisted a deviceId + deviceSecret, mint a short access token with
  //    a single bearer-less POST (no cookie, no navigation). The mint itself runs
  //    through `refreshDeviceSecretArm`, which acquires the client's PROCESS-WIDE
  //    single-flight, persists the rotated `nextDeviceSecret` BEFORE planting the
  //    token, and returns a classified outcome — so this step can never
  //    double-rotate the server against the scheduler/transport/401 lanes, and
  //    the durable store always converges on the true `current` secret.
  steps.push({
    id: 'device-secret-mint',
    run: async () => {
      const result = await refreshDeviceSecretArm({ oxy, store });
      switch (result.status) {
        case 'ok':
          // The arm persisted the rotated secret and planted the token.
          return {
            kind: 'session',
            session: {
              sessionId: result.sessionId,
              userId: result.userId,
              accessToken: result.token,
            },
          };
        case 'invalid-secret': {
          // Stale/diverged secret — drop it so the mint lane stops firing. On
          // native the shared-key step below can still recover; on web this ends
          // signed out. Setting it undefined drops the key on the store's JSON
          // serialization, and the mint guard treats undefined as absent.
          const persisted = await store.load();
          if (persisted) {
            await store.save({ ...persisted, deviceSecret: undefined });
          }
          return { kind: 'skip' };
        }
        case 'no-session':
          // Device known, no live session — authoritative signed-out. Keep the
          // secret (the device may sign in again).
          signedOutReason = 'no_session';
          return { kind: 'skip' };
        case 'persist-failed':
          // The mint rotated the secret but it could not be durably persisted —
          // refuse to advertise a session that will not survive a reload. Keep
          // the secret; a later boot/attempt re-mints once storage recovers.
          logger.error(
            'device-secret mint rotated the secret but it could not be durably persisted — not planting',
            undefined,
            { component: 'sessionColdBoot', method: 'device-secret-mint' },
          );
          return { kind: 'skip' };
        case 'transient':
          // Network / 5xx: keep the secret; a later attempt can succeed.
          logger.debug(
            'device-secret mint failed (transient) — keeping secret',
            { component: 'sessionColdBoot', method: 'device-secret-mint' },
          );
          return { kind: 'skip' };
        case 'no-secret':
          return { kind: 'skip' };
      }
    },
  });

  // 3. shared-key-signin (native) — re-mint from the shared identity.
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
