/**
 * Drizzle Schema Barrel
 *
 * One module per table under `src/db/schema/`, each re-exported from here.
 * This file is the single entry point that `drizzle.config.ts` generates
 * migrations from AND the object `config/postgres.ts` hands to `drizzle()` for
 * the relational query API — a table that is not re-exported here is invisible
 * to both, so it gets neither a migration nor a typed query.
 *
 * Only TABLE modules belong here. `columns.ts`, `deferredForeignKeys.ts` and
 * `protectedColumns.ts` are schema support, imported directly by the code that
 * needs them.
 *
 * The conventions every table follows — naming, ids, enums, timestamps, foreign
 * keys, expiry, protected columns — are in `CONVENTIONS.md`. Read it before
 * adding a table.
 */
export * from './appAffinitySeenEvents';
export * from './authChallenges';
export * from './blocks';
export * from './bookmarks';
export * from './conductStrikes';
export * from './labels';
export * from './linkPreviews';
export * from './moderationEffects';
export * from './moderationPolicies';
export * from './moderationPolicySeverityRules';
export * from './moderationPolicyStandingThresholds';
export * from './notifications';
export * from './pushTokens';
export * from './reporterReputationProfiles';
export * from './restrictions';
export * from './reviewerReputationProfiles';
export * from './topics';
export * from './userAnalytics';
export * from './userAncestors';
export * from './userAppData';
export * from './userAuthMethods';
export * from './userFollows';
export * from './userLinkMetadata';
export * from './userLocations';
export * from './users';
export * from './userVerifiedDomains';
export * from './webauthnCredentials';
