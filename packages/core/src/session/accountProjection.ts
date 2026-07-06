/**
 * Unified account-list projection — THE single source of truth.
 *
 * Produces the flat `SwitchableAccount[]` every account chooser renders, by
 * merging the device's server-authoritative session set (`DeviceSessionState`
 * from {@link SessionClient}) with the caller's account graph (`AccountNode[]`
 * from `oxyServices.listAccounts()`), deduped by `accountId`. This lives in
 * `@oxyhq/core` so every `@oxyhq/services` platform variant — and
 * `auth.oxy.so` — all render the SAME list from the SAME logic and cannot
 * diverge.
 *
 * Pure and I/O-free: the caller resolves per-account profiles via
 * `oxyServices.getUsersByIds(...)` and passes them in as `profilesById`, and
 * binds `resolveAvatarUrl` to `oxyServices.getFileDownloadUrl`. This is the same
 * split the former `@oxyhq/services` `buildSwitchableAccounts` used — hoisted
 * into core, keyed directly on `DeviceSessionState` (whose `activeAccountId` is
 * atomic, so no cross-call current-row reconciliation is needed).
 */

import type { DeviceSessionState } from '@oxyhq/contracts';
import type { User } from '../models/interfaces';
import type {
  AccountNode,
  AccountRelationship,
  AccountKind,
  AccountMember,
} from '../mixins/OxyServices.accounts';
import { getAccountDisplayName, getAccountFallbackHandle } from '../utils/accountUtils';

/**
 * The per-account user shape carried by a {@link SwitchableAccount}. The SDK's
 * canonical {@link User} document — either a profile resolved via
 * `oxyServices.getUsersByIds()` (device rows), the caller-supplied
 * `activeUser` override (the freshest copy of the active row), or the `account`
 * document embedded in an account-graph node (graph-only rows).
 */
export type SwitchableAccountUser = User;

/**
 * One account the signed-in user can switch INTO, in the uniform switch model.
 *
 * A switchable account is either a device sign-in, an account-graph node (owned
 * org / shared-with-you), or BOTH (an account that has been switched into
 * becomes a device session while still being a graph node — the two are deduped
 * into a single row). Every row carries a canonical `accountId` (the uniform
 * switch key); `sessionId` is present IFF the account is currently signed in on
 * THIS device.
 */
export interface SwitchableAccount {
  /**
   * Canonical account id (the underlying `User._id`). The single key EVERY
   * switch uses — `controller.switchTo(accountId)`. Always present.
   */
  accountId: string;
  /**
   * Device session id, present IFF this account is signed in on THIS device.
   * Absent for a graph account not yet switched into. Used only for
   * device-scoped actions (per-account sign-out); switching ALWAYS goes through
   * `switchTo(accountId)`.
   */
  sessionId?: string;
  /**
   * Device-local account slot index (0..N-1) carried on the underlying
   * `SessionAccount`. Absent for graph-only rows.
   */
  authuser?: number;
  /** Whether this account is the currently-active one (`accountId === activeAccountId`). */
  isCurrent: boolean;
  /** Whether this account is signed in on THIS device (has a `sessionId`). */
  onDevice: boolean;
  /**
   * The caller's relationship to this account when it appears in the account
   * graph: `self` (the caller's own personal account), `owner` (an org/project/
   * bot the caller owns), or `member` (shared with the caller). Absent for an
   * independent device sign-in that is NOT in the active account's graph.
   */
  relationship?: AccountRelationship;
  /** Account classification (personal/organization/…). Cosmetic badge only. */
  kind?: AccountKind;
  /** Parent account id for 2-level tree grouping, or `null` for a root. */
  parentAccountId?: string | null;
  /**
   * The caller's effective membership (role + permissions) in this account when
   * it appears in the graph, or `null`/absent otherwise. Use `permissions` to
   * gate per-account settings UI.
   */
  callerMembership?: AccountMember | null;
  /** Friendly display name (never blank — falls back to a handle/sentinel). */
  displayName: string;
  /**
   * Real account email, or `null` when the account genuinely has none. NEVER a
   * synthesized `username@oxy.so` — a missing email falls back to the `@handle`
   * secondary line.
   */
  email: string | null;
  /** Resolved avatar thumbnail URL, or `undefined` when the account has no avatar. */
  avatarUrl?: string;
  /** Account's preferred Bloom color preset, or `null` when unset. */
  color: string | null;
  /** The underlying per-account user payload. */
  user: SwitchableAccountUser;
}

/** Input to {@link projectSwitchableAccounts}. */
export interface ProjectSwitchableAccountsInput {
  /**
   * The device-scoped session state from `SessionClient.getState()`. `null`
   * (or an empty account set) contributes no device rows.
   */
  state: DeviceSessionState | null;
  /** The caller's account graph (`oxyServices.listAccounts()`). `[]` when none. */
  graph: AccountNode[];
  /**
   * Per-account profiles resolved via `oxyServices.getUsersByIds()`, keyed by
   * account id (`User.id`). Device accounts whose profile is absent here are
   * omitted until a subsequent fetch resolves them (unless they are the active
   * account and `activeUser` is supplied).
   */
  profilesById: Map<string, User>;
  /**
   * The freshest copy of the ACTIVE account's user (e.g. `useOxy().user`),
   * preferred over `profilesById` for the active row so a just-committed profile
   * edit is reflected immediately. Optional — the controller relies on
   * `profilesById` alone when omitted.
   */
  activeUser?: User | null;
  /** Locale for display-name resolution (passed to `getAccountDisplayName`). */
  locale?: string;
  /**
   * Resolves an avatar file id to a thumbnail URL — bind to
   * `(id) => id ? oxyServices.getFileDownloadUrl(id, 'thumb') : undefined`.
   */
  resolveAvatarUrl: (avatar: string | null | undefined) => string | undefined;
}

/**
 * Pure union of device sign-ins and account-graph nodes into the flat
 * {@link SwitchableAccount}[] every switcher renders.
 *
 * Order: device rows first (in `state.accounts` order, active flagged), then
 * graph-only rows (in graph order). An account present as BOTH a device session
 * and a graph node is deduped into ONE device row enriched with the graph
 * metadata (relationship / kind / parent / membership).
 */
export function projectSwitchableAccounts(input: ProjectSwitchableAccountsInput): SwitchableAccount[] {
  const { state, graph, profilesById, activeUser, locale, resolveAvatarUrl } = input;
  const activeAccountId = state?.activeAccountId ?? null;

  const toRow = (
    accountUser: User,
    opts: {
      sessionId?: string;
      authuser?: number;
      relationship?: AccountRelationship;
      kind?: AccountKind;
      parentAccountId?: string | null;
      callerMembership?: AccountMember | null;
    },
  ): SwitchableAccount => {
    const accountId = accountUser.id?.toString() ?? '';
    const handle = getAccountFallbackHandle(accountUser);
    const secondaryHandle = handle ? `@${handle}` : null;
    return {
      accountId,
      sessionId: opts.sessionId,
      authuser: opts.authuser,
      isCurrent: Boolean(accountId) && accountId === activeAccountId,
      onDevice: Boolean(opts.sessionId),
      relationship: opts.relationship,
      kind: opts.kind,
      parentAccountId: opts.parentAccountId,
      callerMembership: opts.callerMembership,
      displayName: getAccountDisplayName(accountUser, locale),
      // Real email, or the `@handle` fallback (NEVER synthesized).
      email: accountUser.email ?? secondaryHandle,
      avatarUrl: resolveAvatarUrl(accountUser.avatar),
      color: accountUser.color ?? null,
      user: accountUser,
    };
  };

  // --- Device rows (from the server-authoritative session set) ---
  const deviceRows = (state?.accounts ?? []).flatMap((account): SwitchableAccount[] => {
    const isActive = account.accountId === activeAccountId;
    // The active row prefers the freshest `activeUser` (when supplied), then the
    // batch-resolved profile; every other row uses the batch-resolved profile.
    const accountUser: User | undefined = isActive && activeUser
      ? activeUser
      : profilesById.get(account.accountId);
    if (!accountUser) {
      return [];
    }
    return [toRow(accountUser, { sessionId: account.sessionId, authuser: account.authuser })];
  });

  // --- Merge graph nodes, deduping by account id ---
  const byAccountId = new Map<string, SwitchableAccount>();
  const order: string[] = [];
  const remember = (row: SwitchableAccount): void => {
    if (!row.accountId || byAccountId.has(row.accountId)) {
      return;
    }
    byAccountId.set(row.accountId, row);
    order.push(row.accountId);
  };

  for (const row of deviceRows) {
    remember(row);
  }

  for (const node of graph) {
    const existing = byAccountId.get(node.accountId);
    if (existing) {
      // On-device account that is ALSO in the graph: enrich the device row with
      // graph metadata; keep its (freshest) profile + sessionId + active flag.
      byAccountId.set(node.accountId, {
        ...existing,
        relationship: node.relationship,
        kind: node.kind,
        parentAccountId: node.parentAccountId,
        callerMembership: node.callerMembership,
      });
      continue;
    }
    // Graph-only account (owned org / shared, not yet a device session).
    remember(toRow(node.account, {
      relationship: node.relationship,
      kind: node.kind,
      parentAccountId: node.parentAccountId,
      callerMembership: node.callerMembership,
    }));
  }

  return order.flatMap((id) => {
    const row = byAccountId.get(id);
    return row ? [row] : [];
  });
}

/**
 * Every distinct account id referenced by a device session set AND an account
 * graph, sorted for a stable profile-fetch key. Feed to
 * `oxyServices.getUsersByIds(...)`; graph nodes already embed their `account`
 * document, but including their ids lets the caller pass one id set and lets the
 * projection prefer freshly-fetched profiles uniformly.
 */
export function switchableAccountIds(
  state: DeviceSessionState | null,
  graph: AccountNode[],
): string[] {
  const ids = new Set<string>();
  for (const account of state?.accounts ?? []) {
    if (account.accountId) {
      ids.add(account.accountId);
    }
  }
  for (const node of graph) {
    if (node.accountId) {
      ids.add(node.accountId);
    }
  }
  return Array.from(ids).sort();
}
