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
export * from './authCodes';
export * from './authSessions';
export * from './billingSubscriptions';
export * from './billingTransactions';
export * from './blocks';
export * from './bookmarks';
export * from './civicNonces';
export * from './devicePairingSessions';
export * from './deviceSessionAccounts';
export * from './deviceSessions';
export * from './domainVerifications';
export * from './identityBackups';
export * from './identityBindings';
export * from './labels';
export * from './linkPreviews';
export * from './pushTokens';
export * from './securityActivities';
export * from './sessions';
export * from './subscriptions';
export * from './transactions';
export * from './userAncestors';
export * from './userAuthMethods';
export * from './userCredits';
export * from './userLinkMetadata';
export * from './userLocations';
export * from './userVerifiedDomains';
export * from './users';
export * from './wallets';
export * from './webauthnChallenges';
export * from './webauthnCredentials';
