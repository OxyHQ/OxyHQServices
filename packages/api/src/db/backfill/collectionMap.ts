/**
 * THE collection → table map. Every Mongo collection is either mapped or
 * excluded with a reason; there is no third state.
 *
 * `schema/CONVENTIONS.md` names this file's obligation and the reason for it:
 *
 * > Tables: explicit snake_case, plural. `push_tokens`, not Mongoose's derived
 * > `pushtokens`. The derived name is a `pluralize()` artifact, not a design
 * > (`appaffinityeventseens` is not a word) […] The backfill therefore needs an
 * > explicit collection → table map; write it out, one entry per table.
 *
 * ## The collection names are READ, not derived
 *
 * Mongoose derived most of its collection names by pluralising the model name
 * rather than declaring them, so neither side of this map can be computed from
 * the other. Three independent shapes exist in production and all three are
 * represented here:
 *
 * - **Pluralised model name** — the overwhelming majority.
 *   `AppAffinityEventSeen` → `appaffinityeventseens`.
 * - **An explicit third argument to `mongoose.model`** — `federation_keypairs`,
 *   declared inline in `services/federation.service.ts` and therefore the one
 *   collection with no file in `models/` at all.
 * - **A collection whose model no longer exists** — `refreshtokens`,
 *   `fedcmgrants`, `karmas` and the rest of {@link NOT_MIGRATED}. These cannot
 *   be derived from anything: the code that named them was deleted.
 *
 * The runner therefore treats `db.listCollections()` as the authority and
 * checks it against this map. A live collection appearing in NEITHER list is a
 * HARD FAILURE, not a warning — that is the only mechanism that can notice a
 * collection nobody remembered, which is exactly how data goes missing
 * quietly.
 *
 * ## Exclusions carry a reason, and the reason names the commit
 *
 * An unexplained exclusion is indistinguishable from an oversight six months
 * later. Every entry below says what deleted the writer and where to look.
 */

import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { is } from 'drizzle-orm';
import * as schema from '../schema';
import type { CollectionPlan, ExcludedCollection } from './plan';
import { planTables, tableName } from './plan';
import { APPS_BILLING_PLANS } from './plans/appsBilling';
import { AUTH_SESSION_PLANS } from './plans/authSessions';
import { EMAIL_FILES_PLANS } from './plans/emailFiles';
import { REPUTATION_CIVIC_PLANS } from './plans/reputationCivic';
import { USERS_SOCIAL_PLANS } from './plans/usersSocial';

/** Every collection that moves, and what it becomes. */
export const COLLECTION_PLANS: readonly CollectionPlan[] = [
  ...USERS_SOCIAL_PLANS,
  ...AUTH_SESSION_PLANS,
  ...APPS_BILLING_PLANS,
  ...EMAIL_FILES_PLANS,
  ...REPUTATION_CIVIC_PLANS,
];

/**
 * Tables that are BORN in Postgres and have no Mongo counterpart.
 *
 * Every other exclusion in this file is about a Mongo COLLECTION that does not
 * move. This is the opposite direction and it is new: a table that never had a
 * source, because the feature was designed after the cutover.
 *
 * It exists so `tablesWithoutAPlan()` keeps asking its question — "did somebody
 * add a table and forget to migrate it?" — without answering "yes" for a table
 * where the answer is structurally no. A silent allowance would have been the
 * easy version and the wrong one: the whole value of that check is that it is
 * asked from the TABLE side, so an unexplained gap has to be impossible.
 *
 * The reset path reads this too. `resetToEmpty` truncates without `CASCADE` on
 * purpose, and a Postgres-native table referencing a backfilled one (every
 * `follow_*` table references `users`) makes that statement fail outright. They
 * are listed there rather than cascaded into, so the truncate still names
 * everything it touches.
 *
 * ## Before adding one
 *
 * A table belongs here only if no Mongo collection ever held its data. If the
 * data exists in Mongo and you would rather not move it, that is a
 * {@link NOT_MIGRATED} entry with a reason, not this.
 */
export const POSTGRES_NATIVE_TABLES: readonly { table: string; reason: string }[] = [
  {
    table: 'app_categories',
    reason:
      'The app store was designed in Postgres. A store category is a shelf ' +
      'with a label and a running order, and Mongo held no such thing — an ' +
      'application there had a type and a status, never a place in a catalogue.',
  },
  {
    table: 'app_listings',
    reason:
      'What the store shows about an application: slug, copy, shelf and ' +
      'publication state. Mongo\'s `Application` is an OAuth client and ' +
      'carries none of it, which is exactly why the listing is a separate ' +
      'table rather than more columns on `applications`.',
  },
  {
    table: 'app_listing_screenshots',
    reason:
      'Store-page pictures, in the author\'s order, each referencing a file. ' +
      'No Mongo collection ever held a screenshot for an application.',
  },
  {
    table: 'app_reviews',
    reason:
      'Ratings and reviews are new: nobody could leave one before there was a ' +
      'store to leave it in.',
  },
  {
    table: 'app_review_replies',
    reason: 'The publisher\'s answer to a review, and so as new as the review.',
  },
  {
    table: 'follow_namespaces',
    reason:
      'The follow graph (#809) was designed in Postgres. A namespace is an ' +
      'application\'s claim on a kind prefix, and nothing in Mongo ever ' +
      'expressed that — the old follow model had no notion of an application ' +
      'at all.',
  },
  {
    table: 'follow_target_kinds',
    reason:
      'Kinds are registered at runtime by applications. Mongo\'s follow data ' +
      'was user-to-user only, so there is no source for a row describing what ' +
      'a `mercaria.store` is.',
  },
  {
    table: 'follow_targets',
    reason:
      'A target is any followable thing addressed by canonical URI. The Mongo ' +
      'era had users and nothing else; a user\'s target row is created on ' +
      'demand by the registry rather than copied.',
  },
  {
    table: 'follow_relationships',
    reason:
      'The user-owned edge. Mongo\'s user-to-user follows live in ' +
      '`user_follows`, which IS backfilled and remains authoritative for that ' +
      'question; migrating them onto this table is a separate, later decision ' +
      'with its own adapter, not part of the Mongo cutover.',
  },
  {
    table: 'follow_application_overrides',
    reason:
      'Per-application context on a relationship. Requires an application id, ' +
      'which no Mongo follow record carries.',
  },
  {
    table: 'follow_events',
    reason:
      'The transactional outbox. Its rows describe changes made after the ' +
      'cutover; backfilling history into a queue would deliver events for ' +
      'things that already happened.',
  },
];

/**
 * Every collection that deliberately does NOT move, and why.
 *
 * Ordered by the change that retired each one, because they retire in groups
 * and the group is the explanation.
 */
export const NOT_MIGRATED: readonly ExcludedCollection[] = [
  // --- bookkeeping for a Mongo-era migration that already ran ---------------
  {
    collection: 'accountmigrations',
    reason:
      'The idempotency LEDGER of the account-unification scripts ' +
      '(`LEDGER_COLLECTION` in scripts/account-migration-lib.ts), which map an ' +
      'old workspace/managed-account id to the User row that replaced it so a ' +
      're-run is a no-op. It is bookkeeping ABOUT a migration, not application ' +
      'data, and has no Postgres counterpart — every row it describes was ' +
      'already moved into `users` by migrate-accounts-10/20/30/40, which is ' +
      'why those source collections are themselves excluded here. Copying the ' +
      'ledger would import a record of work that no longer needs doing. Note ' +
      'MongoDB retains it either way (nothing in this migration deletes from ' +
      'Mongo), so the old-id-to-new-id audit trail is preserved where it is.',
  },
  // --- the zero-cookie cutover (ccfd1b68, PR #568) --------------------------
  {
    collection: 'refreshtokens',
    reason:
      'The rotating refresh-token family was DELETED whole by the zero-cookie ' +
      'cutover (ccfd1b68, PR #568): the session transport is now {deviceId, ' +
      'deviceSecret} minted at POST /session/device/token, and DeviceSession is ' +
      'the server authority. There is no refresh_tokens table because there is ' +
      'no refresh token. Every row here is a credential for a mechanism that no ' +
      'longer exists — copying them would be copying dead secrets into a live ' +
      'database. Largest excluded collection (26,208 documents in production).',
  },
  {
    collection: 'devicetokens',
    reason:
      'NOT the push-token registry — that is `pushtokens` → `push_tokens`, a ' +
      'separate live collection with an entirely different shape (userId, token, ' +
      'platform, applicationId). `devicetokens` backed the deleted DeviceToken ' +
      'model: an opaque device-ATTRIBUTION credential (tokenHash, deviceId, ' +
      'channel, origin, revokedAt) that let a cookieless cross-site sign-in land ' +
      'in the right DeviceSession. Introduced in fb4ec246, deleted by the same ' +
      'zero-cookie cutover as the refresh family (ccfd1b68). The names differ and ' +
      'so do the meanings; the correspondence was checked against the deleted ' +
      "model's source, not assumed from the name. 211 documents.",
  },
  {
    collection: 'devicehubtickets',
    reason:
      'Backed the post-sign-in hub-ticket sync to auth.oxy.so/sync, deleted with ' +
      'the silent cross-origin lanes (ce9bc6e3, #691 phase 7b). The SDK no longer ' +
      'navigates the top-level window to the IdP in either webAuthMode, so there ' +
      'is nothing to ticket.',
  },

  // --- FedCM + /sso removal (554766e9, PR #540) -----------------------------
  {
    collection: 'fedcmgrants',
    reason:
      'FedCM was deleted ecosystem-wide (554766e9, PR #540). Connected-app grants ' +
      'live on AppGrant → `app_grants`, which is migrated; a FedCM grant is a ' +
      'record of consent given through a browser API Oxy no longer uses. 22 ' +
      'documents.',
  },
  {
    collection: 'fedcmclients',
    reason: 'Same FedCM removal (554766e9). Client registration now lives on Application.',
  },
  {
    collection: 'fedcmnonces',
    reason: 'Same FedCM removal (554766e9). Short-lived nonces for a deleted protocol.',
  },
  {
    collection: 'idphandoffcodes',
    reason:
      'Backed the legacy IdP handoff bridge, removed in 0f37a617 along with the ' +
      '/sso bounce. Single-use codes for a hop that no longer happens.',
  },

  // --- the account graph unification (58b13a80) -----------------------------
  {
    collection: 'workspaces',
    reason:
      'Workspaces were folded into the one relational Account graph (58b13a80): a ' +
      'workspace is now a User row with kind=organization, and its members are ' +
      '`accountmembers` → `account_members`. The data was moved by ' +
      'scripts/migrate-accounts-20-workspaces-to-orgs.ts, which has already run ' +
      'in production — so this collection is a spent source, and re-reading it ' +
      'here would DOUBLE-migrate rows that already exist as users.',
  },
  {
    collection: 'workspacemembers',
    reason:
      'Same unification (58b13a80). Superseded by `accountmembers` → ' +
      '`account_members`; already moved by scripts/migrate-accounts-40-app-members.ts.',
  },
  {
    collection: 'managedaccounts',
    reason:
      'Same unification (58b13a80). A managed account is now a User row with a ' +
      'parent_account_id; already moved by ' +
      'scripts/migrate-accounts-10-managed-to-tree.ts.',
  },
  {
    collection: 'applicationmembers',
    reason:
      'Same unification (58b13a80). Application membership is now ' +
      '`accountmembers` → `account_members` against the owning organisation ' +
      'account; already moved by scripts/migrate-accounts-40-app-members.ts.',
  },

  // --- the Application rename (881f81dc, PR #213) ---------------------------
  {
    collection: 'developerapps',
    reason:
      'The legacy developer-app model was renamed to Application with no ' +
      'migration and no back-compat (881f81dc, PR #213). The production ' +
      '`developerapps` collection was DROPPED after the rename; it held one ' +
      'record and the apps were recreated in the new Console.',
  },

  // --- the reputation replacement (b28f886b, PRs #217/#219) -----------------
  {
    collection: 'karmas',
    reason:
      'Karma was hard-replaced by the Oxy Trust reputation ledger (b28f886b). ' +
      'scripts/migrate-karma-to-reputation.ts exists but is a documented NO-OP ' +
      'against production: every karma collection was verified empty ' +
      'cluster-wide. No table, and nothing to move.',
  },
  {
    collection: 'karmarules',
    reason:
      'Same replacement (b28f886b). Superseded by ReputationRule → ' +
      '`reputation_rules`; verified empty in production.',
  },

  // --- the legacy auth removal (8bfdd965 / 7a6ebeb4) ------------------------
  {
    collection: 'totps',
    reason:
      'The password + social + TOTP 2FA backend was removed (8bfdd965, Fase C). ' +
      'Authentication is key-signed challenge/response plus WebAuthn, both of ' +
      'which have their own tables. A TOTP secret is a live credential for a ' +
      'deleted mechanism.',
  },
  {
    collection: 'recoverycodes',
    reason:
      'Same removal (8bfdd965). Account recovery is the Commons 12-word phrase ' +
      'plus `identitybackups` → `identity_backups`, not server-held codes.',
  },
  {
    collection: 'recoveryfactors',
    reason: 'Same removal (8bfdd965 / 7a6ebeb4). Superseded by the identity-backup envelope.',
  },

  // --- superseded by the follow graph (940fedac) ----------------------------
  {
    collection: 'followers',
    reason:
      'The dead `Followers` model (userID/contentID/created_at) was removed in ' +
      '940fedac when the follow code was cleaned up. It is NOT the social graph: ' +
      'that is `follows` → `user_follows`, which IS migrated. Two similarly named ' +
      'collections, one live and one dead — checked against the deleted model, ' +
      'not the name.',
  },
];

/** How the runner classified a live collection. */
export type CollectionClassification =
  | { readonly kind: 'migrated'; readonly plan: CollectionPlan }
  | { readonly kind: 'excluded'; readonly exclusion: ExcludedCollection }
  | { readonly kind: 'unknown' };

const planByCollection = new Map(COLLECTION_PLANS.map((plan) => [plan.collection, plan]));
const exclusionByCollection = new Map(
  NOT_MIGRATED.map((exclusion) => [exclusion.collection, exclusion])
);

/**
 * Classify a live collection name.
 *
 * `unknown` is the answer the runner turns into a hard failure. It is the only
 * thing standing between "a collection nobody remembered" and silent data loss.
 */
export function classifyCollection(collection: string): CollectionClassification {
  const plan = planByCollection.get(collection);
  if (plan) return { kind: 'migrated', plan };
  const exclusion = exclusionByCollection.get(collection);
  if (exclusion) return { kind: 'excluded', exclusion };
  return { kind: 'unknown' };
}

/**
 * Every table declared in the schema barrel.
 *
 * Written as a loop rather than `.filter(…)` on purpose: the barrel also
 * exports value tuples, regexes and helper functions, so `Object.values`
 * infers a ~200-member union and a user-written type predicate over it fails
 * `TS2677` ("a type predicate's type must be assignable to its parameter's
 * type"). Narrowing inside the loop uses drizzle's own `is`, which is declared
 * against `any` and narrows correctly.
 */
export function allSchemaTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) tables.push(value);
  }
  return tables;
}

/**
 * Tables no plan writes to.
 *
 * Empty is the finish line, in the same spirit as `DEFERRED_FOREIGN_KEYS`: a
 * table with no source is either a table that should be fed by a plan and is
 * not, or a table that legitimately has no Mongo counterpart. There is
 * currently no member of the second class — every one of the 97 tables is fed —
 * so anything this returns is a gap.
 */
export function tablesWithoutAPlan(): string[] {
  const covered = new Set<string>();
  for (const plan of COLLECTION_PLANS) {
    for (const table of planTables(plan)) covered.add(tableName(table));
  }
  const native = new Set(POSTGRES_NATIVE_TABLES.map((entry) => entry.table));
  return allSchemaTables()
    .map((table) => getTableConfig(table).name)
    .filter((name) => !covered.has(name) && !native.has(name))
    .sort();
}

/** Every collection name this map knows about, mapped or excluded. */
export function knownCollections(): string[] {
  return [...planByCollection.keys(), ...exclusionByCollection.keys()].sort();
}
