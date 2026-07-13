/**
 * User Types
 * 
 * Centralized type definitions for user-related operations.
 * Reuses model types to avoid duplication.
 */

import type { IUser } from '../models/User';
import type { UserProfileUpdate, UserResponse } from '@oxyhq/contracts';

// Reuse name structure from IUser
export type UserName = IUser['name'];

// The raw user document a public list query reads is `PublicUserDocument` in
// `utils/publicUserProjection.ts` — it lives next to the projection that
// produces it so the two cannot drift.

export type PublicUserProfile = UserResponse;

// Fields allowed for profile updates
export type ProfileUpdateInput = UserProfileUpdate;

// User statistics
export interface UserStatistics {
  followers: number;
  following: number;
}

// Pagination parameters
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

// Paginated response
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  hasMore: boolean;
  limit: number;
  offset: number;
}

// Follow action result
export interface FollowActionResult {
  action: 'follow' | 'unfollow';
  counts: {
    followers: number;
    following: number;
  };
}

/**
 * The authenticated viewer's OWN social graph, ids-only, in one payload.
 *
 * Consolidates the three per-viewer graph reads consuming apps (Mention, Allo,
 * Homiio) previously made as separate round trips — the accounts the viewer
 * follows, the subset who follow back (mutuals), and the accounts the viewer
 * has blocked. Each list is bounded (see the `MAX_*_IDS` caps in
 * `recommendationWeights`) so the `$in` queries and the response payload stay
 * small regardless of how large the viewer's graph is. Bare ids only — no
 * hydrated DTOs and no `_count` — because the consumer hydrates/ranks itself.
 */
export interface ViewerGraph {
  /** Accounts the viewer follows (most-recent first, bounded). */
  followingIds: string[];
  /** Accounts the viewer follows that ALSO follow the viewer back (bounded). */
  mutualIds: string[];
  /** Accounts the viewer has blocked (bounded). */
  blockedIds: string[];
}
