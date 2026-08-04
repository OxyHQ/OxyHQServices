/**
 * The follow-graph store — the client's single cache authority for #809.
 *
 * The SDK caches none of these reads on purpose (a status cached across a write
 * is the "follow reverts after navigating away and back" bug), which makes this
 * store the one place a status lives between a write and the next read. If a
 * second cache appears above it, the two will disagree the moment one is
 * invalidated and the other is not.
 *
 * ## Keyed by target id, not by user id
 *
 * The legacy `followStore` is keyed by user id because the only followable
 * thing was a user. Here a key is a target of any kind — a topic, a store, an
 * artist, a channel — so nothing in this file may assume what it is looking at.
 * That is the property that lets an application the SDK has never heard of use
 * it without a release.
 *
 * ## Why the status is stored whole
 *
 * Not a boolean. `globalState`, `applicationMode` and `effectiveState` are
 * three separate answers, and a UI that keeps only the last one cannot explain
 * why a follow the user can see in their list does nothing in this app.
 */

import { create } from 'zustand';
import type { FollowApplicationMode, FollowStatus } from '@oxyhq/contracts';

/** The status of one target, or `undefined` when it has never been read. */
type StatusMap = Record<string, FollowStatus | undefined>;

interface FollowTargetState {
  statuses: StatusMap;
  /** In-flight writes, per target. Reads do not set this — only mutations do. */
  pending: Record<string, boolean>;
  errors: Record<string, string | undefined>;

  setStatus: (targetId: string, status: FollowStatus) => void;
  /**
   * Seed many statuses at once — from a follow list, a feed payload, anything
   * that already knows. Saves one request per rendered row, which is the
   * difference between a list that paints and a list that flickers.
   */
  seed: (entries: Record<string, FollowStatus>) => void;
  setPending: (targetId: string, pending: boolean) => void;
  setError: (targetId: string, error: string | undefined) => void;
  /** Drop everything. Called on identity change — see the note below. */
  reset: () => void;
}

/**
 * The state one target is in before the server has been asked. Distinct from
 * "not following": a button that renders `following: false` while the answer is
 * unknown invites a second follow that the user did not intend.
 */
export const UNKNOWN_FOLLOW_STATUS: FollowStatus = {
  following: false,
  relationshipId: null,
  globalState: null,
  applicationMode: 'inherit',
  effectiveState: 'inactive',
};

export const useFollowTargetStore = create<FollowTargetState>((set) => ({
  statuses: {},
  pending: {},
  errors: {},

  setStatus: (targetId, status) =>
    set((s) => ({ statuses: { ...s.statuses, [targetId]: status } })),

  seed: (entries) => set((s) => ({ statuses: { ...s.statuses, ...entries } })),

  setPending: (targetId, pending) =>
    set((s) => ({ pending: { ...s.pending, [targetId]: pending } })),

  setError: (targetId, error) => set((s) => ({ errors: { ...s.errors, [targetId]: error } })),

  // Every entry here is scoped to whoever was signed in when it was read. On an
  // account switch the whole map is wrong, not stale — the next user's follows
  // are a different set entirely, and showing one user their previous
  // account's follow state is a privacy failure rather than a rendering one.
  reset: () => set({ statuses: {}, pending: {}, errors: {} }),
}));

/**
 * Apply a mode change to a cached status without a round trip.
 *
 * Exported because the optimistic path and the settled path must agree on what
 * `effectiveState` becomes; deriving it in two places is how they drift.
 */
export function withApplicationMode(
  status: FollowStatus,
  mode: FollowApplicationMode
): FollowStatus {
  return {
    ...status,
    applicationMode: mode,
    effectiveState:
      mode === 'disabled' || status.globalState === null
        ? 'inactive'
        : // `enabled` and `inherit` both act on the global state here; what
          // separates them is what happens to a LATER global change, which is
          // the server's business and not visible in this snapshot.
          status.globalState,
  };
}
