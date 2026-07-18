/**
 * Profile-discovery query builders.
 *
 * Pure, stateless helpers that assemble the Mongo `$match` shapes for the
 * recommendation/discovery surfaces (the `/profiles/recommendations` and
 * `/profiles/:userId/similar` aggregation pipelines). They live in `utils/`
 * because they perform no I/O and hold no state — they only build query
 * objects — and are shared by every pipeline that surfaces "who to follow"
 * candidates so the eligibility/quality bar stays consistent across them.
 */

export const FEDERATED_RECOMMENDATION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const NON_EMPTY_STRING: Record<string, unknown> = { $type: 'string', $ne: '' };

/** Mongo match fragment shared by every people-discovery surface. */
export const discoverableUserMongoMatch = {
  accountStatus: { $ne: 'archived' as const },
  reputationTier: { $ne: 'restricted' as const },
};

/**
 * Mongo `$match` fragment for username/name people-search surfaces
 * (`GET /profiles/search`, `GET /search`, `POST /users/search`).
 * Extends {@link discoverableUserMongoMatch} with the private-account opt-out
 * used by recommendations (`privacySettings.isPrivateAccount`).
 */
export const peopleSearchMongoMatch = {
  ...discoverableUserMongoMatch,
  'privacySettings.isPrivateAccount': { $ne: true as const },
};

/**
 * Whether a hydrated user document may appear on people-discovery surfaces
 * (ActivityPub actor lookup, profile shells, etc.).
 */
export function isDiscoverableUser(
  user: { accountStatus?: string; reputationTier?: string } | null | undefined,
): boolean {
  return (
    !!user &&
    user.accountStatus !== 'archived' &&
    user.reputationTier !== 'restricted'
  );
}

/**
 * Whether a user may seed or expose a social-graph discovery surface
 * (`GET /users/:userId/{followers,following,mutuals}`, `/profiles/:userId/similar`).
 * Extends {@link isDiscoverableUser} with the private-account opt-out.
 */
export function isPublicGraphTarget(
  user:
    | {
        accountStatus?: string;
        reputationTier?: string;
        privacySettings?: { isPrivateAccount?: boolean };
      }
    | null
    | undefined,
): boolean {
  return isDiscoverableUser(user) && user?.privacySettings?.isPrivateAccount !== true;
}

/**
 * Whether a user may be discovered via ActivityPub (actor GET, WebFinger).
 * Extends {@link isDiscoverableUser} with the explicit `fediverseSharing` opt-out.
 */
export function isFederatableUser(
  user:
    | {
        accountStatus?: string;
        reputationTier?: string;
        privacySettings?: { fediverseSharing?: boolean };
      }
    | null
    | undefined,
): boolean {
  if (!user || !isDiscoverableUser(user)) return false;
  return user.privacySettings?.fediverseSharing !== false;
}

export function federatedRecommendationEligibilityMatch(
  minResolvedAt: Date,
  prefix = '',
): Record<string, unknown> {
  const field = (name: string) => `${prefix}${name}`;

  return {
    $or: [
      { [field('type')]: { $ne: 'federated' } },
      {
        [field('type')]: 'federated',
        [field('federation.actorUri')]: NON_EMPTY_STRING,
        [field('federation.domain')]: NON_EMPTY_STRING,
        [field('federation.lastResolvedAt')]: { $gte: minResolvedAt },
        [field('federation.unavailableAt')]: { $exists: false },
      },
    ],
  };
}

/**
 * Minimum profile-quality bar for the discovery surface.
 *
 * The recommendation pool is dominated by incomplete shell accounts — created
 * by signup/register/QA with nothing but a username or a bare public key, no
 * avatar, no name, no bio. Surfacing those as "who to follow" is worse than
 * returning a short list, so every users-collection candidate must clear two
 * gates:
 *
 *   1. a real, non-empty `username` (no key-only ghost accounts), AND
 *   2. at least ONE genuine signal that a human curated the profile —
 *      an avatar, a structured name (first/last), a bio/description, or a
 *      verification badge.
 *
 * This is intentionally NOT a name/email blocklist: it filters on real profile
 * completeness fields, so it degrades gracefully (a short, clean list) as the
 * pool fills with genuine profiles rather than padding with shells. Social
 * activity (follower count) is an additional quality signal applied as a sort
 * key downstream — it cannot live in this initial `$match` because the count is
 * computed by a later `$lookup`.
 *
 * @param prefix path prefix for pipelines that nest the user under `user.`
 *   (e.g. follower-ranked rows looked up from the Follow collection).
 */
export function profileQualityMatch(prefix = ''): Record<string, unknown> {
  const field = (name: string) => `${prefix}${name}`;

  return {
    [field('username')]: NON_EMPTY_STRING,
    $or: [
      { [field('avatar')]: NON_EMPTY_STRING },
      { [field('name.first')]: NON_EMPTY_STRING },
      { [field('name.last')]: NON_EMPTY_STRING },
      { [field('bio')]: NON_EMPTY_STRING },
      { [field('description')]: NON_EMPTY_STRING },
      { [field('verified')]: true },
    ],
  };
}

/**
 * Excludes accounts flagged as NSFW/adult/sensitive at the ACCOUNT level
 * (`User.isSensitive`, set by moderation only) from the discovery surface so a
 * sensitive profile (e.g. an adult-content creator or a porn-bot) is never
 * suggested as "who to follow". This is the account flag, NOT the viewer's
 * `privacySettings.sensitiveContent` preference. `{ $ne: true }` (rather than
 * `false`) so legacy/federated docs missing the field — which default to
 * not-sensitive — still pass, making the gate a no-op until the flag is
 * populated.
 *
 * @param prefix path prefix for pipelines that nest the user under `user.`
 *   (e.g. follower-ranked rows looked up from the Follow collection).
 */
export function nonSensitiveAccountMatch(prefix = ''): Record<string, unknown> {
  return { [`${prefix}isSensitive`]: { $ne: true } };
}

/**
 * Combined eligibility gate for the recommendation/discovery surface: a user
 * must be a fresh, available federated actor (or non-federated), clear the
 * minimum profile-quality bar, AND not be flagged as an account-level
 * sensitive/NSFW profile. `federatedRecommendationEligibilityMatch` and
 * `profileQualityMatch` each contribute their own top-level `$or`, so they are
 * combined under a single `$and` — spreading them into one object would
 * silently drop the first `$or`.
 *
 * @param prefix path prefix for pipelines that nest the user under `user.`
 *   (e.g. follower-ranked rows looked up from the Follow collection).
 */
export function eligibleUserMatch(minResolvedAt: Date, prefix = ''): { $and: Record<string, unknown>[] } {
  const field = (name: string) => `${prefix}${name}`;

  return {
    $and: [
      federatedRecommendationEligibilityMatch(minResolvedAt, prefix),
      profileQualityMatch(prefix),
      nonSensitiveAccountMatch(prefix),
      // Dead federated actors (POST /federation/actor-gone), archived org/project
      // accounts, and punitive `restricted` reputation tier must never surface
      // in discovery pipelines. `{ $ne: 'restricted' }` still matches docs whose
      // `reputationTier` is absent (untiered/new users).
      { [field('accountStatus')]: discoverableUserMongoMatch.accountStatus },
      { [field('reputationTier')]: discoverableUserMongoMatch.reputationTier },
    ],
  };
}
