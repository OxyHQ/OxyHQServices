/**
 * coldBootV2 — one device-first cold boot for every consumer.
 *
 * On a fresh page load / app launch this resolves the device's session in a
 * deterministic order, built on the pure `runColdBoot` primitive. It NEVER
 * redirects to a login page: an unresolved boot ends in a signed-out state that
 * the app renders with a "Sign in with Oxy" button.
 *
 * Ordered steps (first to yield a session wins):
 *   1. `bootstrap-return` (web) — consume a `#oxy_boot` return fragment from a
 *      just-completed cross-apex hop: strip it, verify state, persist the
 *      deviceToken, exchange the code.
 *   2. `stored-tokens` — the persisted per-origin refresh family: warm-plant a
 *      still-valid access token, else rotate via `/auth/refresh-token`.
 *   3. `shared-key-signin` (native) — re-mint from the shared-keychain identity,
 *      issuing + mirroring a shared deviceToken the first time.
 *   4. `bootstrap-hop` (web) — same-apex: an inline credentialed
 *      `/auth/device/web-session` fetch (no redirect); cross-apex: ONE top-level
 *      navigation to `/auth/device/bootstrap`, guarded once-ever per origin.
 *   5. Signed out.
 *
 * All mutable guard state lives in STORAGE (localStorage `oxy.boot.attempted` +
 * sessionStorage `oxy.boot.state`), never in module scope, so the guard holds
 * under Metro/bundler re-evaluation.
 *
 * ESM-safe (no `require()`); no react/react-native/expo imports.
 */
import { resolveUserId } from '@oxyhq/contracts';
import { runColdBoot, type ColdBootOutcome, type ColdBootStep } from '../utils/coldBoot';
import { isWeb as detectWeb, isNative as detectNative } from '../utils/platform';
import { extractErrorStatus } from '../utils/errorUtils';
import { KeyManager } from '../crypto/keyManager';
import { logger } from '../utils/loggerUtils';
import type { OxyServices } from '../OxyServices';
import type { AuthStateStore, PersistedAuthState } from '../session/authStateStore';
import { refreshPersistedSession } from '../session/refresh';
import {
  consumeDeviceBootReturn,
  hashHasBootFragment,
  BOOT_STATE_SESSION_KEY,
  type DeviceBootSession,
} from './deviceBootReturn';

/**
 * localStorage flag marking that the cross-apex bootstrap navigation has fired
 * once for this origin. Persistent (not session) so the visible redirect
 * happens AT MOST ONCE EVER per browser+origin — a signed-out user is never
 * bounced again; they sign in explicitly.
 */
export const BOOT_ATTEMPTED_KEY = 'oxy.boot.attempted';

/**
 * Do not warm-plant a stored access token with less than this remaining — it
 * would need an immediate refresh anyway, so fall through to the rotate path.
 * Matches the refresh lead window.
 */
const WARM_MIN_REMAINING_MS = 60_000;

/** Why a cold boot ended without a session. */
export type SignedOutReason =
  | 'no_session'
  | 'new_device'
  | 'state-mismatch'
  | 'error';

/**
 * The DOM/storage seam. All access is injected so the boot is unit-testable
 * under the jest `node` environment; {@link createBrowserColdBootDom} provides
 * the guarded real-globals implementation used in production.
 */
export interface ColdBootDom {
  getHash(): string;
  stripFragment(): void;
  getSessionItem(key: string): string | null;
  setSessionItem(key: string, value: string): void;
  removeSessionItem(key: string): void;
  getLocalItem(key: string): string | null;
  setLocalItem(key: string, value: string): void;
  getLocationHostname(): string | null;
  /** Current href WITHOUT its hash fragment (the bootstrap `return_to`). */
  getReturnToHref(): string | null;
  navigate(url: string): void;
  /** A fresh high-entropy CSRF state token. */
  randomState(): string;
}

export interface RunSessionColdBootOptions {
  oxy: OxyServices;
  store: AuthStateStore;
  /** Platform hints; default derived from `@oxyhq/core`'s platform detection. */
  platform?: { isWeb?: boolean; isNative?: boolean };
  /**
   * The RP return URL for the cross-apex hop. Defaults to the current href
   * (sans fragment) via the DOM seam.
   */
  returnTo?: string;
  /** Invoked with the winning session (token already planted). */
  onSession?: (session: DeviceBootSession & { via: string }) => void | Promise<void>;
  /** Invoked when the boot ended signed out (not while navigating away). */
  onSignedOut?: (reason: SignedOutReason) => void | Promise<void>;
  onStepError?: (id: string, error: unknown) => void;
  /** DOM/storage seam; defaults to the guarded browser implementation. */
  dom?: ColdBootDom;
}

/**
 * Generate a 128-bit hex CSRF state token. Prefers Web Crypto
 * (`crypto.getRandomValues`, present in browsers and modern Node); falls back
 * to a time+`Math.random` mix only when no CSPRNG is reachable (this token
 * gates a single-use CSRF echo, not a long-lived secret).
 */
function generateStateToken(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 18)}`;
}

/**
 * The guarded real-globals {@link ColdBootDom}. Every accessor tolerates a
 * missing/throwing global (SSR, sandboxed iframe) by returning a neutral value
 * or no-op, so the boot degrades to signed-out rather than crashing.
 */
export function createBrowserColdBootDom(): ColdBootDom {
  const safe = <T>(fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };
  return {
    getHash: () => safe(() => (typeof window !== 'undefined' ? window.location.hash : ''), ''),
    stripFragment: () =>
      safe(() => {
        if (typeof window !== 'undefined' && window.history?.replaceState) {
          const { pathname, search } = window.location;
          window.history.replaceState(null, '', `${pathname}${search}`);
        }
      }, undefined),
    getSessionItem: (key) =>
      safe(() => (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null), null),
    setSessionItem: (key, value) =>
      safe(() => {
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, value);
      }, undefined),
    removeSessionItem: (key) =>
      safe(() => {
        if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(key);
      }, undefined),
    getLocalItem: (key) =>
      safe(() => (typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null), null),
    setLocalItem: (key, value) =>
      safe(() => {
        if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      }, undefined),
    getLocationHostname: () =>
      safe(() => (typeof window !== 'undefined' ? window.location.hostname : null), null),
    getReturnToHref: () =>
      safe(() => {
        if (typeof window === 'undefined') return null;
        const { origin, pathname, search } = window.location;
        return `${origin}${pathname}${search}`;
      }, null),
    navigate: (url) =>
      safe(() => {
        if (typeof window !== 'undefined') window.location.assign(url);
      }, undefined),
    randomState: generateStateToken,
  };
}

/**
 * Registrable domain = the last two labels of a host. A deliberately SMALL
 * local helper (the plan forbids coupling the boot to `fapiAutoDetect`/`tldts`).
 * Correct for every Oxy apex (all two-label domains: `oxy.so`, `mention.earth`,
 * `alia.onl`, `homiio.com`); the only imprecision — a multi-part public suffix
 * such as `co.uk` — never arises here because the compared API host is always
 * `api.oxy.so`, so a page under a different registrable domain still classifies
 * as cross-apex.
 */
function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  return labels.length <= 2 ? labels.join('.') : labels.slice(-2).join('.');
}

/**
 * Is `host` an IP literal (v4/v6) or a single-label host (`localhost`)? Such
 * hosts have NO registrable domain — the last-two-labels heuristic would
 * mis-group them (`192.168.1.1` and `10.0.1.1` both collapse to `1.1`; IPv6
 * `::1` and `localhost` are single "labels"), so a LAN/dev page could be wrongly
 * classified same-apex as a different LAN API and skip the cross-apex hop.
 */
function isIpOrSingleLabel(host: string): boolean {
  if (host.includes(':')) {
    return true; // IPv6 literal
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return true; // IPv4 literal
  }
  return !host.includes('.'); // single-label (e.g. `localhost`)
}

/**
 * True when both hosts are same-site / same-apex. For a normal multi-label host
 * pair, that means sharing a registrable domain. For an IP literal or a
 * single-label host (no registrable domain), same-apex requires the two hosts
 * to be EXACTLY equal — never grouped by a spurious trailing-label match.
 */
export function isSameApex(pageHost: string, apiHost: string): boolean {
  const a = pageHost.toLowerCase();
  const b = apiHost.toLowerCase();
  if (isIpOrSingleLabel(a) || isIpOrSingleLabel(b)) {
    return a === b;
  }
  const ra = registrableDomain(a);
  const rb = registrableDomain(b);
  return ra !== '' && ra === rb;
}

/** Build a `DeviceBootSession` from a persisted state (post-refresh/warm-plant). */
function sessionFromPersisted(state: PersistedAuthState, accessToken: string): DeviceBootSession {
  return { sessionId: state.sessionId, userId: state.userId, accessToken };
}

/**
 * How a `mintFromDeviceSecret` (phase 2c) call failed, distinguished so the cold
 * boot can react per the transport contract:
 *  - `invalid_secret` — the presented secret no longer matches (another tab/
 *    device rotated it, or theft divergence). Drop it and fall back.
 *  - `no_active_session` — the device is known but has no live session.
 *    Authoritative signed-out; keep the secret, do not fall back to the hop.
 *  - `transient` — network / 5xx. Keep the secret and let the fallback lanes try.
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
 * a side effect, invokes `onSession` (winning session, token already planted)
 * or `onSignedOut` (no session — unless the boot is navigating away for the
 * cross-apex hop, in which case neither fires).
 */
export async function runSessionColdBoot(
  opts: RunSessionColdBootOptions,
): Promise<ColdBootOutcome<DeviceBootSession>> {
  const { oxy, store } = opts;
  const dom = opts.dom ?? createBrowserColdBootDom();
  const isWeb = opts.platform?.isWeb ?? detectWeb();
  const isNative = opts.platform?.isNative ?? detectNative();

  // Signed-out reason + navigating flag are boot-local (not module-level), so
  // they cannot leak across boots or break under bundler re-evaluation.
  let signedOutReason: SignedOutReason = 'no_session';
  let navigating = false;
  // Set when the zero-cookie mint reports `no_active_session` (phase 2c): the
  // device is authoritatively signed out, so the migratory fallback lanes below
  // (stored-tokens / shared-key / bootstrap-hop) must NOT run — we already know
  // there is no session and must not bounce a known-signed-out device.
  let deviceKnownSignedOut = false;

  const steps: Array<ColdBootStep<DeviceBootSession>> = [];

  // 0. device-secret-mint (phase 2c) — the zero-cookie fast path. When the
  //    origin persisted a deviceId + deviceSecret, mint a short access token with
  //    a single bearer-less POST (no cookie, no navigation). FIRST in the chain
  //    so it wins over the migratory cookie lanes below. Gated OFF while a
  //    #oxy_boot return fragment is present so `bootstrap-return` still consumes
  //    + strips it first (a device holding a secret never triggers that hop, so
  //    this only defers a rare stale/forged fragment). The rest of the chain
  //    stays as the additive migratory fallback for devices not yet on the secret.
  steps.push({
    id: 'device-secret-mint',
    enabled: () => !(isWeb && hashHasBootFragment(dom.getHash())),
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
          // Stale/diverged secret — drop it so the mint lane stops firing, then
          // fall through to the migratory refresh/cookie lanes. Setting it
          // undefined drops the key on the store's JSON serialization, and the
          // mint guard treats undefined as absent.
          await store.save({ ...persisted, deviceSecret: undefined });
          return { kind: 'skip' };
        }
        if (failure === 'no_active_session') {
          // Device known, no live session — authoritative signed-out. KEEP the
          // secret and stop the chain (do not bounce a known-signed-out device).
          deviceKnownSignedOut = true;
          signedOutReason = 'no_session';
          return { kind: 'skip' };
        }
        // Transient (network / 5xx): keep the secret, let the fallback lanes try.
        logger.debug(
          'device-secret mint failed (transient) — keeping secret, falling back',
          { component: 'coldBootV2', method: 'device-secret-mint' },
          error,
        );
        return { kind: 'skip' };
      }
    },
  });

  // 1. bootstrap-return (web) — consume a #oxy_boot fragment.
  steps.push({
    id: 'bootstrap-return',
    enabled: () => isWeb && hashHasBootFragment(dom.getHash()),
    run: async () => {
      const outcome = await consumeDeviceBootReturn({
        hash: dom.getHash(),
        stripFragment: () => dom.stripFragment(),
        readExpectedState: () => dom.getSessionItem(BOOT_STATE_SESSION_KEY),
        clearExpectedState: () => dom.removeSessionItem(BOOT_STATE_SESSION_KEY),
        store,
        exchangeBootCode: (code) => oxy.exchangeBootCode(code),
        plantAccessToken: (accessToken) => oxy.setTokens(accessToken),
      });
      if (outcome.kind === 'session') {
        return { kind: 'session', session: outcome.session };
      }
      if (outcome.kind === 'state-mismatch') {
        signedOutReason = 'state-mismatch';
      } else if (outcome.kind === 'no-session') {
        // `DeviceBootReason` also carries 'session'; a no-session outcome with
        // that reason (a `session` reason but no code) is still signed out.
        signedOutReason = outcome.reason === 'new_device' ? 'new_device' : 'no_session';
      }
      // Fall through: a stored refresh family (a prior same-origin session) may
      // still recover below. The once-ever flag blocks a second hop.
      return { kind: 'skip' };
    },
  });

  // 2. stored-tokens — warm-plant or rotate the persisted refresh family.
  steps.push({
    id: 'stored-tokens',
    enabled: () => !deviceKnownSignedOut,
    run: async () => {
      const persisted = await store.load();
      if (!persisted) {
        return { kind: 'skip' };
      }
      // Warm path: a still-valid access token → plant immediately (no network).
      if (
        persisted.accessToken &&
        persisted.expiresAt &&
        Date.parse(persisted.expiresAt) - Date.now() > WARM_MIN_REMAINING_MS
      ) {
        oxy.setTokens(persisted.accessToken);
        return { kind: 'session', session: sessionFromPersisted(persisted, persisted.accessToken) };
      }
      // Rotate path: refreshPersistedSession plants + persists, and clears the
      // store on a family-revoked error.
      const token = await refreshPersistedSession({ oxy, store, allowSharedKeyFallback: isNative });
      if (!token) {
        return { kind: 'skip' };
      }
      const after = await store.load();
      const base = after ?? persisted;
      return { kind: 'session', session: sessionFromPersisted(base, token) };
    },
  });

  // 3. shared-key-signin (native) — re-mint from the shared identity.
  steps.push({
    id: 'shared-key-signin',
    enabled: () => isNative && !deviceKnownSignedOut,
    run: async () => {
      const session = await oxy.signInWithSharedIdentity();
      if (!session?.accessToken) {
        return { kind: 'skip' };
      }
      // First shared-key sign-in on this device: issue + persist + mirror a
      // shared deviceToken so every native Oxy app joins one DeviceSession.
      // Best-effort — never fail the sign-in over device-token issuance.
      try {
        const existing = await KeyManager.getSharedDeviceToken();
        if (!existing) {
          const deviceToken = await oxy.issueNativeDeviceToken();
          await store.saveDeviceToken(deviceToken);
          await KeyManager.setSharedDeviceToken(deviceToken);
        }
      } catch (error) {
        logger.debug(
          'Native deviceToken issuance skipped',
          { component: 'coldBootV2', method: 'shared-key-signin' },
          error,
        );
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

  // 4. bootstrap-hop (web, terminal) — same-apex inline fetch OR cross-apex nav.
  steps.push({
    id: 'bootstrap-hop',
    enabled: () => isWeb && !deviceKnownSignedOut,
    run: async () => {
      const pageHost = dom.getLocationHostname();
      let apiHost: string | null = null;
      try {
        apiHost = new URL(oxy.getBaseURL()).hostname;
      } catch {
        apiHost = null;
      }
      if (!pageHost || !apiHost) {
        return { kind: 'skip' };
      }

      // Same-apex: inline credentialed fetch, no redirect, runs every boot.
      if (isSameApex(pageHost, apiHost)) {
        const result = await oxy.requestWebSession();
        // The rotated deviceToken is on BOTH arms (it is device-level, not
        // session-level) — persist it before branching on the session.
        await store.saveDeviceToken(result.deviceToken);
        if (result.reason === 'session') {
          const bundle = result.session;
          const userId = resolveUserId(bundle.user);
          if (!userId) {
            return { kind: 'skip' };
          }
          const next: PersistedAuthState = {
            sessionId: bundle.sessionId,
            refreshToken: bundle.refreshToken,
            userId,
            deviceToken: result.deviceToken,
            accessToken: bundle.accessToken,
            expiresAt: bundle.expiresAt,
          };
          // Phase 2c: the web-session bundle may carry a rotating `deviceSecret`
          // but NOT a deviceId. Persist the secret and carry any prior deviceId
          // (from a deviceId-bearing login lane) forward so the mint lane stays
          // usable — this overwrite must not orphan it.
          const prior = await store.load();
          if (prior?.deviceId) {
            next.deviceId = prior.deviceId;
          }
          // Prefer the bundle's secret (the server just rotated onto it); keep the
          // prior one when the bundle omits it — this lane also runs as the
          // TRANSIENT-mint fallback, and must not orphan a still-valid secret.
          const carriedSecret = bundle.deviceSecret ?? prior?.deviceSecret;
          if (carriedSecret) {
            next.deviceSecret = carriedSecret;
          }
          await store.save(next);
          oxy.setTokens(bundle.accessToken);
          return { kind: 'session', session: sessionFromPersisted(next, bundle.accessToken) };
        }
        // Known device, signed out.
        signedOutReason = result.reason;
        return { kind: 'skip' };
      }

      // Cross-apex: ONE visible top-level navigation, once-ever per origin.
      if (dom.getLocalItem(BOOT_ATTEMPTED_KEY)) {
        return { kind: 'skip' };
      }
      const returnTo = opts.returnTo ?? dom.getReturnToHref();
      if (!returnTo) {
        return { kind: 'skip' };
      }
      const state = dom.randomState();
      dom.setSessionItem(BOOT_STATE_SESSION_KEY, state);
      dom.setLocalItem(BOOT_ATTEMPTED_KEY, '1');
      navigating = true;
      dom.navigate(oxy.buildBootstrapUrl(returnTo, state));
      return { kind: 'skip' };
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

  // Navigating away for the cross-apex hop: the page is unloading, so do not
  // flash a signed-out state.
  if (!navigating) {
    await opts.onSignedOut?.(signedOutReason);
  }
  return outcome;
}
