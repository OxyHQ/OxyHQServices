import * as crypto from 'crypto';
import type { DeviceSessionState, SessionAccount } from '@oxyhq/contracts';
import DeviceSession, { IDeviceSession, IDeviceSessionAccount } from '../models/DeviceSession';
import sessionService from './session.service';
import { revokeAllFamiliesBySession } from './refreshToken.service';
import { revokeDeviceTokens } from './deviceToken.service';
import { sha256Hex, base64UrlEncode, timingSafeStringEqual } from './oauthCode.service';
import { logger } from '../utils/logger';

/** Number of random bytes in a raw `deviceSecret` (256-bit). */
const DEVICE_SECRET_BYTES = 32;
/**
 * Grace window during which the just-superseded `deviceSecret` is still accepted
 * after a rotation, so a multi-tab race presenting the previous secret is not
 * locked out (rotation-in-use — mirrors the refresh-family single-use-with-grace).
 */
const DEVICE_SECRET_GRACE_MS = 60_000;

function idToString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'toString' in (value as object)) return (value as { toString(): string }).toString();
  return String(value);
}

export function projectState(doc: IDeviceSession): DeviceSessionState {
  const accounts: SessionAccount[] = (doc.accounts ?? []).map((a: IDeviceSessionAccount) => {
    const operatedBy = idToString(a.operatedByUserId ?? null);
    const account: SessionAccount = { accountId: idToString(a.accountId) ?? '', sessionId: a.sessionId, authuser: a.authuser };
    if (operatedBy) account.operatedByUserId = operatedBy;
    return account;
  });
  return {
    deviceId: doc.deviceId,
    accounts,
    activeAccountId: idToString(doc.activeAccountId),
    revision: doc.revision ?? 0,
    updatedAt: (doc.updatedAt ?? new Date()).getTime(),
  };
}

function lowestFreeAuthuser(accounts: IDeviceSessionAccount[]): number {
  const used = new Set(accounts.map((a) => a.authuser));
  let i = 0;
  while (used.has(i)) i += 1;
  return i;
}

export type SwitchActiveResult =
  | { ok: true; state: DeviceSessionState }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'unauthorized'; state: DeviceSessionState };

// `changed` is false only for an idempotent re-register (same account, same
// session) — the cold-boot reload handoff. The route uses it to skip the
// device-state broadcast when nothing actually changed.
export type AddAccountResult = { state: DeviceSessionState; changed: boolean };

class DeviceSessionService {
  private async load(deviceId: string): Promise<IDeviceSession | null> {
    return DeviceSession.findOne({ deviceId }).lean<IDeviceSession>();
  }

  async getState(deviceId: string): Promise<DeviceSessionState> {
    const existing = await this.load(deviceId);
    if (existing) return this.healActiveAccount(existing);
    const created = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $setOnInsert: { deviceId, accounts: [], activeAccountId: null, revision: 0 } },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(created as IDeviceSession);
  }

  // Self-heals a device's active account when it is a managed (act_as)
  // account whose operator membership has since been revoked.
  // `resolveActiveToken` already refuses to mint a token for such an account,
  // but without this the dead account keeps sitting in `accounts`/
  // `activeAccountId` forever — the client would durably render "logged in
  // as <org>" while holding the previous account's bearer. One pass only:
  // drop the revoked account via the existing signout cascade and return the
  // healed state; a newly-elected active account is left for the *next*
  // getState call to re-validate rather than re-checked recursively here.
  // Non-managed (personal) active accounts are never touched by this path —
  // a personal account with a transiently-unresolvable access token must not
  // be dropped, only a managed account whose act_as membership check failed.
  private async healActiveAccount(doc: IDeviceSession): Promise<DeviceSessionState> {
    const activeId = idToString(doc.activeAccountId);
    if (!activeId) return projectState(doc);
    const active = (doc.accounts ?? []).find((a) => idToString(a.accountId) === activeId);
    const operatedBy = active ? idToString(active.operatedByUserId ?? null) : null;
    if (!active || !operatedBy) return projectState(doc);
    const validated = await sessionService.validateSessionById(active.sessionId, false);
    if (validated) return projectState(doc);
    logger.info('deviceSession.getState: dropping revoked managed active account', {
      deviceId: doc.deviceId,
      accountId: activeId,
    });
    return this.signout(doc.deviceId, { accountId: activeId });
  }

  // Registering a session into the device set. Reload ≠ sign-in: the client
  // cold-boot handoff calls this on EVERY reload with the RESTORED session to
  // re-register it, so this must be idempotent and must NOT steal the device's
  // active account. Three cases:
  //   1. Same account + SAME session already present  → pure no-op: return the
  //      current state untouched (no active flip, no revision bump, no write).
  //      This is the reload handoff; flipping active here silently reverted a
  //      prior account switch on the next reload.
  //   2. Same account + DIFFERENT session (deliberate re-auth of that account)
  //      → replace the session (deactivating the displaced one), set active,
  //      bump revision.
  //   3. New account (fresh sign-in / first-entry mint) → add, set active, bump.
  async addAccount(
    deviceId: string,
    input: { accountId: string; sessionId: string; operatedByUserId?: string },
    opts?: { activate?: 'always' | 'if-empty' },
  ): Promise<AddAccountResult> {
    // `activate` default 'always' keeps every existing caller (device
    // add/switch, cold-boot handoff) byte-identical. 'if-empty' is the ADD-ONLY
    // attribution semantic used by the device-first login lanes: register the
    // new account into the set but NEVER steal the device's current active
    // selection — it only becomes active when nothing else is.
    const activate = opts?.activate ?? 'always';
    const current = await this.load(deviceId);
    const existing = (current?.accounts ?? []).find((a) => idToString(a.accountId) === input.accountId);

    // Case 1 — idempotent re-register (the cold-boot reload handoff).
    if (current && existing && existing.sessionId === input.sessionId) {
      return { state: projectState(current), changed: false };
    }

    const currentActiveId = idToString(current?.activeAccountId ?? null);
    // 'if-empty' preserves an existing active account; only claims active when
    // the device currently has none.
    const nextActiveAccountId =
      activate === 'always' || !currentActiveId ? input.accountId : currentActiveId;

    const others = (current?.accounts ?? []).filter((a) => idToString(a.accountId) !== input.accountId);
    // Case 2 — replacing an account's session (re-add with a new sessionId) must
    // deactivate the session it displaces — otherwise a live, server-side session
    // is left dangling with no device-session entry referencing it.
    if (existing && existing.sessionId !== input.sessionId) {
      try {
        await sessionService.deactivateSession(existing.sessionId);
      } catch (error) {
        logger.warn('deviceSession.addAccount: deactivate replaced session failed', { sessionId: existing.sessionId, error });
      }
    }
    const authuser = lowestFreeAuthuser(others);
    const account = {
      accountId: input.accountId,
      sessionId: input.sessionId,
      authuser,
      addedAt: new Date(),
      operatedByUserId: input.operatedByUserId ?? null,
    };
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      {
        $set: { accounts: [...others, account], activeAccountId: nextActiveAccountId },
        $inc: { revision: 1 },
      },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return { state: projectState(updated as IDeviceSession), changed: true };
  }

  async switchActive(deviceId: string, accountId: string): Promise<SwitchActiveResult> {
    const current = await this.load(deviceId);
    const target = (current?.accounts ?? []).find((a) => idToString(a.accountId) === accountId);
    if (!current || !target) return { ok: false, reason: 'not_found' };

    // Re-validate the target account's session BEFORE committing the switch.
    // For a managed account this re-checks the operator's act_as membership
    // (ensureManagedSessionAuthorized) and rejects the switch instead of
    // durably pointing the device at an account the caller no longer has
    // authority over (see resolveActiveToken, which does the same check on
    // read but can't undo an already-committed activeAccountId).
    const validated = await sessionService.validateSessionById(target.sessionId, false);
    if (!validated) {
      // The target session is revoked (e.g. the operator's act_as membership
      // was pulled). Leaving it in the device set strands a dead account the
      // device can never switch into. Heal by removing it through the SAME
      // signout cascade a normal removal uses, and return the healed state so
      // the route can broadcast it to the device's other tabs/connections.
      const state = await this.signout(deviceId, { accountId });
      return { ok: false, reason: 'unauthorized', state };
    }

    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      { $set: { activeAccountId: accountId }, $inc: { revision: 1 } },
      { new: true },
    ).lean<IDeviceSession>();
    if (!updated) return { ok: false, reason: 'not_found' };
    return { ok: true, state: projectState(updated) };
  }

  async resolveActiveToken(state: DeviceSessionState): Promise<{ accessToken: string; expiresAt: string } | null> {
    if (!state.activeAccountId) return null;
    const account = state.accounts.find((a) => a.accountId === state.activeAccountId);
    if (!account) return null;
    // Re-validate before minting a token: for a managed-account session this
    // re-checks the operator's act_as membership (ensureManagedSessionAuthorized)
    // and deactivates+rejects a revoked session instead of handing out a token
    // for an account the caller no longer has authority over.
    const validated = await sessionService.validateSessionById(account.sessionId, false);
    if (!validated) return null;
    const token = await sessionService.getAccessToken(account.sessionId);
    if (!token) return null;
    return { accessToken: token.accessToken, expiresAt: token.expiresAt.toISOString() };
  }

  async signout(deviceId: string, target: { accountId: string } | { all: true }): Promise<DeviceSessionState> {
    const current = await this.load(deviceId);
    if (!current) return this.getState(deviceId);
    const allAccounts = current.accounts ?? [];

    let removingIds: Set<string>;
    if ('all' in target) {
      removingIds = new Set(allAccounts.map((a) => idToString(a.accountId) ?? ''));
    } else {
      const targetPresent = allAccounts.some((a) => idToString(a.accountId) === target.accountId);
      if (!targetPresent) return projectState(current);
      removingIds = new Set([target.accountId]);
      // Cascade: signing out an operator's own account must also remove every
      // managed/org account that operator switched into on this device (one
      // level deep — operated accounts can't themselves operate others).
      for (const a of allAccounts) {
        if (idToString(a.operatedByUserId) === target.accountId) {
          removingIds.add(idToString(a.accountId) ?? '');
        }
      }
    }

    const removing = allAccounts.filter((a) => removingIds.has(idToString(a.accountId) ?? ''));
    for (const a of removing) {
      try {
        await sessionService.deactivateSession(a.sessionId);
      } catch (error) {
        logger.warn('deviceSession.signout: deactivate failed', { sessionId: a.sessionId, error });
      }
      // Cascade the signout to the persisted rotating refresh families:
      // deactivateSession alone leaves a stored refresh token able to mint fresh
      // access tokens, so revoke EVERY family bound to the session. Best-effort —
      // a revoke failure must never block the signout.
      try {
        await revokeAllFamiliesBySession(a.sessionId);
      } catch (error) {
        logger.warn('deviceSession.signout: refresh family revoke failed', { sessionId: a.sessionId, error });
      }
    }

    // Signout-ALL also severs the device's ATTRIBUTION bindings: revoke every
    // deviceToken issued for this device so a retained token (400-day sliding
    // TTL) can never later attach a fresh sign-in as active into the now-empty
    // set. Only on the {all} path — a single-account signout deliberately leaves
    // deviceTokens alone, since other apps/accounts on the SAME device still
    // legitimately use theirs to attribute their own sign-ins. Best-effort — a
    // revoke failure must never block signout.
    //
    // We deliberately do NOT clear the `oxy_device` cookie here: device identity
    // is not an account credential (an empty device set grants NOTHING via
    // bootstrap — reason resolves to `no_session`), and clearing a cookie via
    // Set-Cookie on a cross-apex fetch response is 3rd-party-cookie-blocked
    // anyway. The next bootstrap simply re-uses the same empty device.
    if ('all' in target) {
      try {
        await revokeDeviceTokens(deviceId);
      } catch (error) {
        logger.warn('deviceSession.signout: device token revoke failed', { deviceId, error });
      }
    }

    const remaining = allAccounts.filter((a) => !removingIds.has(idToString(a.accountId) ?? ''));
    const activeStillPresent = remaining.some((a) => idToString(a.accountId) === idToString(current.activeAccountId));
    const nextActive = activeStillPresent ? idToString(current.activeAccountId) : (remaining[0] ? idToString(remaining[0].accountId) : null);
    // Signout-ALL also revokes the device's `deviceSecret` (phase 2c): clear the
    // secret hashes so a retained secret can never later mint a token for the now-
    // empty set. Single-account signout leaves the secret alone — other accounts
    // on the SAME device still legitimately mint with it. `cookieKeyHash` is NEVER
    // cleared here; it lives until the cookie-lane cutover.
    const updated = await DeviceSession.findOneAndUpdate(
      { deviceId },
      {
        $set: { accounts: remaining, activeAccountId: nextActive },
        $inc: { revision: 1 },
        ...('all' in target ? { $unset: { secretHash: '', prevSecretHash: '', prevSecretExpiresAt: '' } } : {}),
      },
      { new: true, upsert: true },
    ).lean<IDeviceSession>();
    return projectState(updated as IDeviceSession);
  }

  /**
   * Resolve the session ALREADY REGISTERED for `accountId` on `deviceId` (added
   * via `/session/device/add`) so an IdP mint can REUSE it instead of minting a
   * separate per-origin session. This enforces the "ONE session per account per
   * device" invariant: every RP origin that authenticates this account on this
   * device converges on the SAME sessionId the DeviceSession entry holds — they
   * join one socket room and see each other's cross-domain broadcasts. Without
   * it each origin gets its own per-origin session, and the device doc (which
   * stores ONE sessionId per account) can never make them converge.
   *
   * Returns null — the caller falls through to a fresh create — when the device
   * has no entry for the account (true first sign-in on this device), the
   * registered session is no longer valid (signed out, or a managed act_as
   * membership was revoked), or the token machinery cannot mint. NEVER
   * resurrects a dead session: validation runs BEFORE any token is minted. The
   * access token is minted/rotated through the standard `getAccessToken` path,
   * so it carries the registered session's central `deviceId` claim.
   */
  async resolveRegisteredSession(
    deviceId: string,
    accountId: string,
  ): Promise<{ sessionId: string; deviceId: string; accessToken: string; expiresAt: Date } | null> {
    const current = await this.load(deviceId);
    if (!current) return null;
    const entry = (current.accounts ?? []).find((a) => idToString(a.accountId) === accountId);
    if (!entry) return null;

    // Re-validate before minting: for a managed-account session this re-checks
    // the operator's act_as membership and refuses a revoked session. A dead
    // session yields null (fall through to create) — it is never resurrected.
    const validated = await sessionService.validateSessionById(entry.sessionId, false);
    if (!validated) return null;
    const token = await sessionService.getAccessToken(entry.sessionId);
    if (!token) return null;

    return {
      sessionId: entry.sessionId,
      deviceId: validated.session.deviceId,
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
    };
  }

  /**
   * Detach an account from a device doc after its session MIGRATED to another
   * device (see the deviceId migration in `sessionService.createSession`).
   * Removes the account's entry from THIS device's `accounts[]` so the stale
   * (graveyard) doc stops advertising a live-looking account, and deactivates
   * the session the doc referenced — UNLESS it is `preserveSessionId`, the
   * session that just moved (which stays active on its new device). Best-effort
   * cleanup: a no-op when the doc is absent or the account is not listed. Never
   * throws for a missing account so callers can fire it without guarding.
   */
  async detachMigratedAccount(deviceId: string, accountId: string, preserveSessionId: string): Promise<void> {
    const current = await this.load(deviceId);
    if (!current) return;
    const accounts = current.accounts ?? [];
    const entry = accounts.find((a) => idToString(a.accountId) === accountId);
    if (!entry) return;

    // Deactivate a DIFFERENT (genuinely stale) session the doc referenced —
    // never the one that just migrated and is now live on the caller's device.
    if (entry.sessionId && entry.sessionId !== preserveSessionId) {
      try {
        await sessionService.deactivateSession(entry.sessionId);
      } catch (error) {
        logger.warn('deviceSession.detachMigratedAccount: deactivate failed', { sessionId: entry.sessionId, error });
      }
    }

    const remaining = accounts.filter((a) => idToString(a.accountId) !== accountId);
    const activeStillPresent = remaining.some((a) => idToString(a.accountId) === idToString(current.activeAccountId));
    const nextActive = activeStillPresent
      ? idToString(current.activeAccountId)
      : (remaining[0] ? idToString(remaining[0].accountId) : null);
    await DeviceSession.updateOne(
      { deviceId },
      { $set: { accounts: remaining, activeAccountId: nextActive }, $inc: { revision: 1 } },
    );
  }

  /**
   * Resolve the `DeviceSessionState` bound to an `oxy_device` cookie SECRET.
   * The cookie value is hashed and looked up against `cookieKeyHash` — the raw
   * secret is never stored, and the deviceId is never derivable from the cookie.
   * Returns null when the cookie maps to no device (unknown / pruned / never
   * planted).
   */
  async getStateByCookieKey(rawCookieKey: string): Promise<DeviceSessionState | null> {
    if (typeof rawCookieKey !== 'string' || rawCookieKey.length === 0) return null;
    const cookieKeyHash = sha256Hex(rawCookieKey);
    const doc = await DeviceSession.findOne({ cookieKeyHash }).lean<IDeviceSession>();
    if (!doc) return null;
    return projectState(doc);
  }

  /**
   * Ensure a device exists for a fresh `oxy_device` cookie. Mints a NEW random
   * deviceId AND a NEW random 256-bit cookie secret, persists a device doc bound
   * to `sha256(secret)`, and returns both. Called by the bootstrap hop when the
   * request carries no (or an unknown) device cookie — the caller then plants the
   * returned `rawCookieKey` as the `oxy_device` cookie. The deviceId is server-
   * minted and never leaves the server; only the opaque cookie secret does.
   */
  async ensureDeviceForCookie(): Promise<{ deviceId: string; rawCookieKey: string }> {
    const deviceId = crypto.randomUUID();
    const rawCookieKey = base64UrlEncode(crypto.randomBytes(32));
    const cookieKeyHash = sha256Hex(rawCookieKey);
    await DeviceSession.create({
      deviceId,
      accounts: [],
      activeAccountId: null,
      revision: 0,
      cookieKeyHash,
    });
    return { deviceId, rawCookieKey };
  }

  /**
   * Issue (rotating) the `deviceSecret` bound to a device (phase 2c — zero-cookie
   * transport). Mints a fresh 256-bit secret, stores only its `sha256` in
   * `secretHash`, and — when a prior secret existed — moves that prior hash into
   * `prevSecretHash` with a short `prevSecretExpiresAt` grace so a concurrent tab
   * presenting the just-superseded secret is not locked out (rotation-in-use).
   *
   * The WRITE is a single atomic `findOneAndUpdate`; the grace window (not a lock)
   * is the multi-tab concurrency mitigation — mirroring the refresh family. The
   * raw secret is returned to the caller EXACTLY ONCE and is NEVER logged.
   *
   * Returns null when no `DeviceSession` doc exists for `deviceId` (or it vanished
   * between read and write): a secret is only ever bound to a real device doc,
   * never to a phantom device (no upsert).
   */
  async issueDeviceSecret(deviceId: string): Promise<string | null> {
    // Two concurrent rotations (multi-tab mint, parallel sign-ins) must not
    // clobber each other: last-writer-wins would drop the first writer's fresh
    // secret entirely (neither current nor prev). Compare-and-swap on the
    // secretHash we read; on a lost race, re-read once and rotate on top of the
    // winner — the winner's secret then sits in the grace slot, so BOTH clients
    // end up holding a mintable secret.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = await DeviceSession.findOne({ deviceId }).lean<IDeviceSession>();
      if (!current) return null;

      const rawSecret = base64UrlEncode(crypto.randomBytes(DEVICE_SECRET_BYTES));
      const secretHash = sha256Hex(rawSecret);

      const set: { secretHash: string; prevSecretHash?: string; prevSecretExpiresAt?: Date } = { secretHash };
      if (current.secretHash) {
        set.prevSecretHash = current.secretHash;
        set.prevSecretExpiresAt = new Date(Date.now() + DEVICE_SECRET_GRACE_MS);
      }

      const updated = await DeviceSession.findOneAndUpdate(
        current.secretHash
          ? { deviceId, secretHash: current.secretHash }
          : { deviceId, secretHash: { $exists: false } },
        { $set: set },
        { new: true },
      ).lean<IDeviceSession>();
      if (updated) return rawSecret;
    }
    return null;
  }

  /**
   * Resolve the `DeviceSessionState` bound to a raw `deviceSecret` (phase 2c). The
   * secret is hashed and matched — constant-time — against the device's current
   * `secretHash` OR, within the grace window, its `prevSecretHash`. Returns null
   * when the device is unknown, carries no secret, or the secret does not match
   * (possession of the deviceId alone reveals nothing).
   */
  async getStateBySecret(deviceId: string, rawSecret: string): Promise<DeviceSessionState | null> {
    if (typeof deviceId !== 'string' || deviceId.length === 0) return null;
    if (typeof rawSecret !== 'string' || rawSecret.length === 0) return null;

    const doc = await DeviceSession.findOne({ deviceId }).lean<IDeviceSession>();
    if (!doc) return null;

    const hash = sha256Hex(rawSecret);
    if (typeof doc.secretHash === 'string' && doc.secretHash.length > 0 && timingSafeStringEqual(hash, doc.secretHash)) {
      return projectState(doc);
    }
    if (
      typeof doc.prevSecretHash === 'string' &&
      doc.prevSecretHash.length > 0 &&
      doc.prevSecretExpiresAt instanceof Date &&
      doc.prevSecretExpiresAt.getTime() > Date.now() &&
      timingSafeStringEqual(hash, doc.prevSecretHash)
    ) {
      return projectState(doc);
    }
    return null;
  }

  /**
   * Converge a caller's account onto the CANONICAL `oxy_device`-cookie device
   * doc. Fixes the split-brain where a pre-cookie session lives on the old
   * JWT-claims-era device doc while the cookie doc (born via `ensureDeviceForCookie`
   * during bootstrap) is empty — so `/auth/device/resolve` + bootstrap/web-session
   * saw an empty device despite live sessions.
   *
   * The session must ALREADY have been migrated onto `cookieDeviceId` at the
   * Session level (`sessionService.migrateSessionToDevice`) BEFORE this call, so
   * the follow-up `resolveActiveToken(cookieState)` mints an access token whose
   * `deviceId` claim addresses the cookie device. Here we: register the account
   * on the cookie doc (`activate: 'always'` — an explicit `/add` sets it active,
   * matching today's behaviour), detach it from the old doc (preserving the
   * just-migrated session), and return BOTH resulting states so the route can
   * broadcast both device rooms. `changed` is the cookie-doc mutation flag.
   */
  async convergeAccountOntoDevice(
    cookieDeviceId: string,
    oldDeviceId: string,
    input: { accountId: string; sessionId: string; operatedByUserId?: string },
  ): Promise<{ cookieState: DeviceSessionState; oldState: DeviceSessionState; changed: boolean }> {
    // Capture the old doc's revision BEFORE detaching. The client's `applyState`
    // is last-writer-wins by `revision` ACROSS the device set, so the canonical
    // cookie doc must out-rank the retired doc's revision — otherwise the fresh
    // (low-revision) converged state loses to the stale high-revision old-device
    // state the client still holds and the migration would never be applied.
    const oldBefore = await this.load(oldDeviceId);
    const oldRevisionBefore = oldBefore?.revision ?? 0;

    const { state: added, changed } = await this.addAccount(cookieDeviceId, input);

    let cookieState = added;
    if (changed && added.revision <= oldRevisionBefore) {
      const bumped = await DeviceSession.findOneAndUpdate(
        { deviceId: cookieDeviceId },
        { $set: { revision: oldRevisionBefore + 1 } },
        { new: true },
      ).lean<IDeviceSession>();
      if (bumped) cookieState = projectState(bumped);
    }

    await this.detachMigratedAccount(oldDeviceId, input.accountId, input.sessionId);
    // Plain find, NEVER `getState` — the latter UPSERTS an empty doc, which would
    // manufacture a garbage device record for a retired/unknown old deviceId. When
    // the old doc is absent (session was never registered on a device doc, or the
    // id is stale), synthesize an empty state to broadcast WITHOUT persisting.
    const oldDoc = await this.load(oldDeviceId);
    const oldState: DeviceSessionState = oldDoc
      ? projectState(oldDoc)
      : { deviceId: oldDeviceId, accounts: [], activeAccountId: null, revision: 0, updatedAt: Date.now() };
    return { cookieState, oldState, changed };
  }
}

// Exported BOTH as the default (existing static `import deviceSessionService`
// call sites) AND as a named export so dynamic `await import(...)` consumers can
// destructure it cleanly under NodeNext CJS interop (a default-only export
// resolves to the namespace object there — same reason `account.service`
// exports `accountService` by name).
export const deviceSessionService = new DeviceSessionService();
export default deviceSessionService;
