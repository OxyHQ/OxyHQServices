/**
 * `users` — the account. Every other table in this schema ultimately hangs off it.
 *
 * Ported from `models/User.ts`. The Mongo document was ~1000 lines of nested
 * subdocuments; what follows is the schema this table would have had if it had
 * been designed on Postgres, so several things deliberately do NOT travel:
 *
 * - **`following[]` / `followers[]` are DELETED.** They duplicated the `Follow`
 *   collection, which is the single authority. An embedded id array cannot be
 *   joined or constrained; the junction table already exists.
 * - **`_count.followers` / `_count.following` are DELETED.** Cached counters
 *   exist because Mongo cannot JOIN. `count(*)` over `follows` with its index is
 *   the replacement — a counter comes back only against a measurement.
 * - **`locations` / `linksMetadata` / `authMethods` / `verifiedDomains` /
 *   `ancestors` are child tables**, not arrays. Seven indexes hung off
 *   `locations.*` alone.
 * - **`federation.*` and `automation.*` are columns**, not `jsonb`: their inner
 *   paths carried sparse indexes, which `jsonb` cannot serve without a
 *   hand-written expression index per path.
 * - The `id` virtual (`publicKey ?? _id`) does not travel. The `toJSON`
 *   transform overwrote `ret.id` with `_id` unconditionally, so the publicKey
 *   branch was already dead on every serialized path.
 * - `name.full`, `name.displayName` and `did` were VIRTUALS. They stay derived —
 *   `composeDisplayName` / `buildUserDid` at the serializer.
 *
 * ## Case-insensitive unique on the three identifiers
 *
 * `email` and `public_key` were `lowercase: true` in Mongoose, so their stored
 * values are already lower-cased and a unique index on `lower(...)` is
 * equivalent on existing data — but it also survives a call site that forgets to
 * normalize, which the Mongoose setter used to cover and Postgres has no
 * counterpart for.
 *
 * `username` is the one that CHANGES behaviour, deliberately: Mongo indexed it
 * case-SENSITIVELY while every lookup runs
 * `exactCaseInsensitiveUsernameRegex` (`server.ts:688`, `webauthn.ts:376`, …).
 * That pairing both permitted `Nate` and `nate` to coexist and made each lookup
 * a collection scan, since an anchored `/i` regex cannot use a b-tree index.
 * `lower(username)` fixes both. **Backfill consequence:** if two production
 * accounts differ only by case, the backfill fails on this index and names them
 * — the correct outcome, since the application cannot tell them apart today.
 *
 * Every lookup must therefore be written `where lower(username) = lower($1)`.
 * A plain `username = $1` is correct-looking, case-sensitive, and will not use
 * the index.
 *
 * ## Contact hashes are GENERATED, not application code
 *
 * `hashed_email` / `hashed_phone` were maintained by a `pre('validate')` hook
 * whose own doc comment called it the single source of truth "precisely because
 * bypassing it is the known failure mode". A generated column closes that
 * properly: no write path — route, service, backfill, or `psql` — can produce a
 * row whose hash disagrees with its source. See `contactHash.ts` for the
 * canonicalization these expressions reproduce, and
 * `__tests__/users.test.ts` for the test that pins the two implementations
 * together.
 */

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  ORGANIZATION_CATEGORIES as CONTRACT_ORGANIZATION_CATEGORIES,
  TRUST_TIERS as CONTRACT_TRUST_TIERS,
  type OrganizationCategory,
  type TrustTier,
} from '@oxyhq/contracts';
import { createdAt, generatedId, timestamptz, updatedAt } from './columns';

/**
 * Named color presets a user may pick. `oxy` is premium-gated at the service
 * layer; the constraint permits it so an already-premium user can persist it.
 *
 * Declared here rather than imported from `models/User.ts`: that module pulls in
 * mongoose and `did.service`, and `drizzle.config.ts` loads this schema to emit
 * DDL. The Mongoose copy is authoritative until the model is deleted; the test
 * in `__tests__/users.test.ts` holds the two in agreement until then.
 */
export const USER_COLOR_PRESETS = [
  'teal',
  'blue',
  'green',
  'amber',
  'red',
  'purple',
  'pink',
  'sky',
  'orange',
  'mint',
  'oxy',
] as const;

/**
 * 3- or 6-digit hex, case-insensitive.
 *
 * Legacy accounts stored raw hex before the named presets existed. The match is
 * case-INSENSITIVE (`~*`) even though the Mongoose setter lower-cased on write:
 * a row written before that setter existed would otherwise be rejected by the
 * backfill, turning a cosmetic field into a failed migration.
 */
const LEGACY_HEX_COLOR_PATTERN = '^#([0-9a-f]{3}|[0-9a-f]{6})$';

/** Federation/automation flavour of the account. Orthogonal to `kind`. */
export const USER_TYPES = ['local', 'federated', 'agent', 'automated'] as const;

/**
 * Account-graph classification. `personal` is the only kind that may
 * authenticate directly; the rest are operated through `account_members`.
 */
export const ACCOUNT_KINDS = ['personal', 'organization', 'project', 'bot'] as const;

/** Account-graph lifecycle. `archived` accounts keep their tree edges. */
export const ACCOUNT_STATUSES = ['active', 'archived'] as const;

/** Light/dark/system, shared by `preference_theme` and `theme_preference_mode`. */
export const THEME_MODES = ['light', 'dark', 'system'] as const;

/**
 * Real-estate / team taxonomy, meaningful only for `kind: 'organization'`.
 * `satisfies` proves every value is a valid contract category; the `Gap` type
 * below proves the reverse, so adding one in contracts fails THIS file's
 * typecheck rather than silently producing a value the CHECK rejects.
 */
export const ORGANIZATION_CATEGORIES = [
  ...CONTRACT_ORGANIZATION_CATEGORIES,
] as const satisfies readonly OrganizationCategory[];

/** `never` while `ORGANIZATION_CATEGORIES` covers the contract union. */
export type OrganizationCategoryGap = Exclude<
  OrganizationCategory,
  (typeof ORGANIZATION_CATEGORIES)[number]
>;

/** Denormalized mirror of `ReputationBalance.trustTier`. Same `satisfies` guard. */
export const TRUST_TIERS = [
  ...CONTRACT_TRUST_TIERS,
] as const satisfies readonly TrustTier[];

/** `never` while `TRUST_TIERS` covers the contract union. */
export type TrustTierGap = Exclude<TrustTier, (typeof TRUST_TIERS)[number]>;

/** Inactivity windows an account may choose. `null` means "never expire". */
export const ACCOUNT_EXPIRY_DAYS = [30, 90, 180, 365] as const;

/** The influence floor (`INFLUENCE_MIN`), the default ranking weight. */
const DEFAULT_REPUTATION_RANK_WEIGHT = 0.1;

/** Applied to a new account that declares no locale. */
export const DEFAULT_USER_LANGUAGES = ['en-US'] as const;

/** Renders a `const` tuple as a SQL `in (...)` list. */
function inList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}

/**
 * The UTF-8 bytes of a text value, as an IMMUTABLE expression.
 *
 * `convert_to(x, 'UTF8')` is the obvious spelling and Postgres rejects it in a
 * generated column: it is marked STABLE, because in principle the source
 * encoding is a server setting. `decode(x, 'escape')` IS immutable and reads
 * the same bytes, but it also interprets backslash sequences — so doubling
 * every backslash first makes it an exact inverse. Verified byte-for-byte
 * against `convert_to` over ASCII, multibyte UTF-8, literal backslashes and
 * octal-looking sequences; the equality is re-asserted in
 * `__tests__/users.test.ts`.
 *
 * This is why no `CREATE EXTENSION` and no helper function are needed: the
 * expression is pure core Postgres and drizzle-kit can emit it from this file.
 */
function utf8Bytes(expression: string): string {
  return `decode(replace(${expression}, '\\', '\\\\'), 'escape')`;
}

/** `encode(sha256(<utf8 bytes of expression>), 'hex')` — lowercase hex, always. */
function sha256Hex(expression: string): string {
  return `encode(sha256(${utf8Bytes(expression)}), 'hex')`;
}

/**
 * `hashEmail`'s canonicalization: trim, lowercase, SHA-256, hex. A value that is
 * blank after trimming hashes to NULL, matching `maybeHashEmail`'s `undefined`.
 */
const HASHED_EMAIL_EXPRESSION = sql.raw(
  `case when btrim(coalesce(email, '')) = '' then null ` +
    `else ${sha256Hex('lower(btrim(email))')} end`
);

/**
 * `hashPhone`'s canonicalization: strip every non-digit, prepend `+`, SHA-256,
 * hex. A value with no digits hashes to NULL, matching `maybeHashPhone`.
 *
 * No backslash-doubling concern of its own — the hashed form is `+` followed by
 * digits, so `utf8Bytes`' `replace` is provably a no-op here. It is applied
 * anyway rather than special-cased, because one derivation used by both columns
 * cannot drift and a "provably unnecessary" branch is exactly what rots.
 */
const HASHED_PHONE_EXPRESSION = sql.raw(
  `case when regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = '' then null ` +
    `else ${sha256Hex(`'+' || regexp_replace(phone, '[^0-9]', '', 'g')`)} end`
);

export const users = pgTable(
  'users',
  {
    id: generatedId(),

    // ---- identifiers -------------------------------------------------------
    /** Unique case-insensitively — see the header. Absent for key-only accounts. */
    username: text(),
    /** Unique case-insensitively. Absent for key-only and federated accounts. */
    email: text(),
    /**
     * E.164-style phone, raw. PROTECTED: never in a default select — see
     * `protectedColumns.ts`.
     */
    phone: text(),
    /**
     * SHA-256 hex of the canonical email. GENERATED — not writable, and it can
     * never disagree with `email`. PROTECTED.
     */
    hashedEmail: text().generatedAlwaysAs(HASHED_EMAIL_EXPRESSION),
    /** SHA-256 hex of the canonical phone. GENERATED. PROTECTED. */
    hashedPhone: text().generatedAlwaysAs(HASHED_PHONE_EXPRESSION),
    /** Uncompressed secp256k1 public key, hex. Unique case-insensitively. */
    publicKey: text(),
    /**
     * PROTECTED. Retained because the column still exists on live documents;
     * the zero-cookie cutover left the session's own refresh token on
     * `sessions`, and nothing writes this one any more. Whether the column
     * travels past the backfill is a call for whoever ports `Session`.
     */
    refreshToken: text(),

    // ---- name --------------------------------------------------------------
    // Mongoose defaulted both to `''`. Absent is NULL here: `''` is a value, and
    // `composeDisplayName` already treats blank and absent identically.
    nameFirst: text(),
    nameLast: text(),

    // ---- account graph -----------------------------------------------------
    kind: text({ enum: ACCOUNT_KINDS }).notNull().default('personal'),
    /** Meaningful only when `kind = 'organization'`. */
    organizationCategory: text({ enum: ORGANIZATION_CATEGORIES }),
    /**
     * Immediate parent in the ownership tree; NULL means "root".
     *
     * `SET NULL` rather than `CASCADE`: `parent_account_id` defaults to the
     * creator's own personal account (`routes/accounts.ts:489`), so CASCADE
     * would make one human's GDPR erasure delete an organization other people
     * belong to, and then its projects, recursively. Promoting an orphan to a
     * root is the state NULL already means, and the organization survives its
     * founder.
     */
    parentAccountId: text().references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    /**
     * Root of this account's tree. NULL means "this row is its own root", which
     * is exactly how the application already reads it (`rootAccountId ?? _id`,
     * `routes/accounts.ts:212`). `SET NULL` for the same reason as the parent.
     */
    rootAccountId: text().references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),
    accountStatus: text({ enum: ACCOUNT_STATUSES }).notNull().default('active'),

    // ---- federation / automation ------------------------------------------
    type: text({ enum: USER_TYPES }).notNull().default('local'),
    /** ActivityPub actor URI — globally unique across the fediverse. */
    federationActorUri: text(),
    federationDomain: text(),
    /** `FederatedActor._id` in the consuming app's database. Never resolved here. */
    federationActorId: text(),
    /** Advances even on a 304, so the refresh throttle survives a restart. */
    federationLastAvatarFetchedAt: timestamptz(),
    federationAvatarETag: text(),
    federationAvatarLastModified: text(),
    federationLastResolvedAt: timestamptz(),
    /** Set when the remote actor stops resolving and leaves discovery surfaces. */
    federationUnavailableAt: timestamptz(),
    federationUnavailableReason: text(),
    /**
     * The human who owns an automated account.
     *
     * `SET NULL`, not `CASCADE`: NULL already means "not owned", and an
     * ownerless bot is a state moderation can see and act on. CASCADE would
     * delete a whole separate account, and everything referencing it, as a side
     * effect of an unrelated erasure.
     */
    automationOwnerId: text().references((): AnyPgColumn => users.id, {
      onDelete: 'set null',
    }),

    // ---- standing ----------------------------------------------------------
    verified: boolean().notNull().default(false),
    /** Mirror of `ReputationBalance.influence.rankingFeedbackWeight`. */
    reputationRankWeight: doublePrecision()
      .notNull()
      .default(DEFAULT_REPUTATION_RANK_WEIGHT),
    /** Mirror of `ReputationBalance.trustTier`. */
    reputationTier: text({ enum: TRUST_TIERS }).notNull().default('new'),
    /** Administrator-set only — never via a self-service route. */
    isStaff: boolean().notNull().default(false),
    /** Proof-of-personhood genesis node. Administrator-set only. */
    isSeedVerifier: boolean().notNull().default(false),
    /** Account-level NSFW flag (moderation-set). Distinct from the VIEWER's preference. */
    isSensitive: boolean().notNull().default(false),
    /**
     * Ordered BCP-47 locales, primary first. A handful of short values never
     * queried by element, so a native array rather than a child table.
     */
    languages: text()
      .array()
      .notNull()
      .default([...DEFAULT_USER_LANGUAGES]),

    // ---- profile -----------------------------------------------------------
    /** File id in the assets collection. */
    avatar: text(),
    /**
     * Named preset or legacy hex. Generated in the APPLICATION, as Mongoose did
     * — the default picks a random preset per row, which a SQL `DEFAULT` would
     * have to reimplement.
     */
    color: text()
      .notNull()
      .$defaultFn(() => randomUserColor()),
    bio: text(),
    description: text(),
    address: text(),
    /** Free-form date string, exactly as Mongo stored it. Never parsed here. */
    birthday: text(),
    /** Profile links. A short scalar array, never queried by element. */
    links: text().array(),
    /**
     * 30/90/180/365 or NULL (never expire). `Mixed` in Mongoose ONLY so it could
     * hold `null`, so it is an ordinary nullable integer with a CHECK — not
     * `jsonb`.
     */
    accountExpiresAfterInactivityDays: integer(),

    // ---- privacy settings --------------------------------------------------
    // A nested object with a fully known shape: real columns, not `jsonb`. Kept
    // on `users` rather than a 1:1 child table — every row would have exactly
    // one child with every column NOT NULL, so the table would buy a join on
    // every profile read and a second insert on every signup, for nothing.
    privacyIsPrivateAccount: boolean().notNull().default(false),
    privacyHideOnlineStatus: boolean().notNull().default(false),
    privacyHideLastSeen: boolean().notNull().default(false),
    privacyProfileVisibility: boolean().notNull().default(true),
    privacyLoginAlerts: boolean().notNull().default(true),
    privacyBlockScreenshots: boolean().notNull().default(false),
    privacyLogin: boolean().notNull().default(true),
    privacyBiometricLogin: boolean().notNull().default(false),
    privacyShowActivity: boolean().notNull().default(true),
    privacyAllowTagging: boolean().notNull().default(true),
    privacyAllowMentions: boolean().notNull().default(true),
    privacyHideReadReceipts: boolean().notNull().default(false),
    privacyAllowDirectMessages: boolean().notNull().default(true),
    privacyDataSharing: boolean().notNull().default(true),
    privacyLocationSharing: boolean().notNull().default(false),
    privacyAnalyticsSharing: boolean().notNull().default(true),
    privacySensitiveContent: boolean().notNull().default(false),
    privacyAutoFilter: boolean().notNull().default(true),
    privacyMuteKeywords: boolean().notNull().default(false),
    /** Opt-in: the stored hashes must not become an enumeration oracle. */
    privacyDiscoverableByEmail: boolean().notNull().default(false),
    privacyDiscoverableByPhone: boolean().notNull().default(false),
    privacyFediverseSharing: boolean().notNull().default(true),

    // ---- email settings ----------------------------------------------------
    /** PROTECTED. Mongoose defaulted to `''`; absent is NULL. */
    emailSignature: text(),
    autoReplyEnabled: boolean().notNull().default(false),
    autoReplySubject: text(),
    autoReplyBody: text(),
    autoReplyStartDate: timestamptz(),
    autoReplyEndDate: timestamptz(),
    /**
     * Forward ALL incoming mail here. PROTECTED. Mongoose defaulted to `''` and
     * every reader tested truthiness; NULL is the honest form, so the ported
     * read is `auto_forward_to is not null`.
     */
    autoForwardTo: text(),
    /** PROTECTED — it is only meaningful alongside `auto_forward_to`. */
    autoForwardKeepCopy: boolean().notNull().default(true),

    // ---- notification channels --------------------------------------------
    notificationPushEnabled: boolean().notNull().default(true),
    notificationEmailDigest: boolean().notNull().default(true),
    notificationSecurityAlerts: boolean().notNull().default(true),
    notificationMarketingEmails: boolean().notNull().default(false),

    // ---- app-wide preferences ---------------------------------------------
    /** Mongoose defaulted to `''`; absent is NULL. */
    preferenceLanguage: text(),
    preferenceTheme: text({ enum: THEME_MODES }).notNull().default('system'),
    preferenceReduceMotion: boolean().notNull().default(false),
    /** Mongoose defaulted to `''`; absent is NULL. */
    preferenceTimezone: text(),

    // ---- portable theme preference ----------------------------------------
    /**
     * Both columns are NULL until the user chooses a theme, and the CHECK below
     * makes "half a preference" unrepresentable. That absence is load-bearing:
     * consumers keep their own default until a real choice exists, which is
     * exactly what `toThemePreference` (`utils/userTransform.ts:71`) enforces at
     * the serializer today. Moving it into the schema is the point — a partial
     * subdocument can no longer be created for the serializer to discard.
     */
    themePreferenceMode: text({ enum: THEME_MODES }),
    themePreferenceColorPreset: text(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // ---- identity uniqueness (trimmed, case-insensitive) ------------------
    // `lower(btrim(...))` and not `lower(...)`: Mongoose's `trim` + `lowercase`
    // setters mean the stored values are ALREADY in this form, so the two are
    // equivalent on existing data — but only this one keeps `' a@b.com'` from
    // becoming a second account, which matters because it is byte-identical to
    // `'a@b.com'` under `hashed_email`'s canonicalization. Two rows that hash to
    // the same contact-discovery token must not be able to coexist.
    //
    // The cost is real and belongs at every call site: a lookup must be written
    // `where lower(btrim(username)) = lower(btrim($1))`. A plain
    // `username = $1` is correct-looking, case-sensitive, and will not use this
    // index.
    uniqueIndex('users_lower_username_key').on(sql`lower(btrim(${t.username}))`),
    uniqueIndex('users_lower_email_key').on(sql`lower(btrim(${t.email}))`),
    uniqueIndex('users_lower_public_key_key').on(sql`lower(btrim(${t.publicKey}))`),
    uniqueIndex('users_federation_actor_uri_key').on(t.federationActorUri),

    // ---- contact discovery ------------------------------------------------
    // Mongo's sparse indexes. Partial here for the same reason: the vast
    // majority of rows have no phone, and many federated rows have neither.
    index('users_hashed_email_idx')
      .on(t.hashedEmail)
      .where(sql`${t.hashedEmail} is not null`),
    index('users_hashed_phone_idx')
      .on(t.hashedPhone)
      .where(sql`${t.hashedPhone} is not null`),

    // ---- account graph traversal -----------------------------------------
    // "This parent's children, of this kind" — Mongo's `{kind, parentAccountId}`.
    // Its standalone `{kind}` index is dropped: a btree serves any leading prefix.
    index('users_kind_parent_account_id_idx').on(t.kind, t.parentAccountId),
    // `countDocuments({ parentAccountId, accountStatus })` (`accounts.ts:223`)
    // leads with the parent, which the compound above cannot serve.
    index('users_parent_account_id_idx')
      .on(t.parentAccountId)
      .where(sql`${t.parentAccountId} is not null`),
    index('users_root_account_id_idx')
      .on(t.rootAccountId)
      .where(sql`${t.rootAccountId} is not null`),

    // ---- federation -------------------------------------------------------
    index('users_type_idx').on(t.type),
    index('users_federation_domain_idx')
      .on(t.federationDomain)
      .where(sql`${t.federationDomain} is not null`),
    index('users_federation_last_resolved_at_idx')
      .on(t.federationLastResolvedAt)
      .where(sql`${t.federationLastResolvedAt} is not null`),
    index('users_federation_unavailable_at_idx')
      .on(t.federationUnavailableAt)
      .where(sql`${t.federationUnavailableAt} is not null`),
    // Mongo also indexed `federation.actorId` (a bare `sparse: true` builds one).
    // Dropped: no query in the codebase reads that field.
    index('users_automation_owner_id_idx')
      .on(t.automationOwnerId)
      .where(sql`${t.automationOwnerId} is not null`),

    // ---- recommendation surface -------------------------------------------
    index('users_reputation_rank_weight_idx').on(t.reputationRankWeight),
    index('users_reputation_tier_idx').on(t.reputationTier),
    index('users_is_sensitive_idx').on(t.isSensitive),

    // ---- closed value sets ------------------------------------------------
    // Columns are INTERPOLATED, never spelled out: `sql.raw('kind in ...')`
    // would hard-code a SQL name this file never chose (drizzle derives it from
    // the casing setting), so only the value lists are raw.
    check('users_kind_check', sql`${t.kind} in (${sql.raw(inList(ACCOUNT_KINDS))})`),
    check(
      'users_organization_category_check',
      sql`${t.organizationCategory} is null or ${t.organizationCategory} in (${sql.raw(inList(ORGANIZATION_CATEGORIES))})`
    ),
    check(
      'users_account_status_check',
      sql`${t.accountStatus} in (${sql.raw(inList(ACCOUNT_STATUSES))})`
    ),
    check('users_type_check', sql`${t.type} in (${sql.raw(inList(USER_TYPES))})`),
    check(
      'users_reputation_tier_check',
      sql`${t.reputationTier} in (${sql.raw(inList(TRUST_TIERS))})`
    ),
    check(
      'users_preference_theme_check',
      sql`${t.preferenceTheme} in (${sql.raw(inList(THEME_MODES))})`
    ),

    // ---- value constraints ------------------------------------------------
    check(
      'users_color_check',
      sql`${t.color} in (${sql.raw(inList(USER_COLOR_PRESETS))}) or ${t.color} ~* ${sql.raw(`'${LEGACY_HEX_COLOR_PATTERN}'`)}`
    ),
    check(
      'users_account_expires_after_inactivity_days_check',
      sql`${t.accountExpiresAfterInactivityDays} is null or ${t.accountExpiresAfterInactivityDays} in (${sql.raw(ACCOUNT_EXPIRY_DAYS.join(', '))})`
    ),
    // A theme preference is whole or absent. `''` counts as absent, matching
    // `toThemePreference`'s `colorPreset.length > 0`, so the backfill maps any
    // partial subdocument to (NULL, NULL) — the same value the serializer
    // already produces for one.
    check(
      'users_theme_preference_check',
      sql`(${t.themePreferenceMode} is null and ${t.themePreferenceColorPreset} is null) or (${t.themePreferenceMode} is not null and ${t.themePreferenceColorPreset} is not null and length(${t.themePreferenceColorPreset}) > 0)`
    ),
    // A row cannot be its own parent. Deeper cycles are the application's
    // problem (`account.service.ts` `wouldCreateCycle`); the one-hop case is
    // free to state here and is the shape a bad write actually produces.
    check('users_parent_account_id_not_self_check', sql`${t.parentAccountId} <> ${t.id}`),
  ]
);

/** A random non-premium preset — the default applied to a new account. */
export function randomUserColor(): string {
  const selectable = USER_COLOR_PRESETS.filter((color) => color !== 'oxy');
  return selectable[Math.floor(Math.random() * selectable.length)];
}
