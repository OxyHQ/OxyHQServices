/**
 * Backfill plans for the account itself and the social graph hanging off it.
 *
 * `users` is the widest table in the schema (83 columns, two of them GENERATED)
 * and the only one in this batch that decomposes into child tables, so almost
 * every trap in this group is in that one transform.
 *
 * ## Every nested Mongo path flattens, and the flattening is the map
 *
 * `name.first` → `name_first`, `federation.actorUri` → `federation_actor_uri`,
 * `privacySettings.*` → `privacy_*`, `notificationPreferences.*` →
 * `notification_*`, `userPreferences.*` → `preference_*`, `themePreference.*` →
 * `theme_preference_*`, `autoReply.*` → `auto_reply_*`, `automation.ownerId` →
 * `automation_owner_id`. The dotted path is passed to the value helpers, which
 * resolve it; the KEY is always the drizzle property name, because `values()`
 * silently drops anything else (see `rowBuilder.ts`).
 *
 * ## What deliberately does NOT travel
 *
 * - `following[]` / `followers[]` — `user_follows` is the single authority, and
 *   it is a real table with real foreign keys. There is no column to write them
 *   to and no `emit` for them here.
 * - `_count.followers` / `_count.following` — denormalized counters with no
 *   column. `count(*)` over `user_follows` replaces them.
 * - `hashedEmail` / `hashedPhone` — GENERATED from `email` / `phone`. Emitting
 *   either is a `BackfillRowError` before it can ever reach Postgres.
 * - `user_locations.geo` and `user_locations.search_vector` — also GENERATED.
 * - `name.full`, `name.displayName`, `did`, the `id` virtual — Mongoose
 *   virtuals, never stored, still derived at the serializer.
 *
 * ## `follows` asserts rather than filters
 *
 * `schema/userFollows.ts` requires it in as many words: the backfill must FAIL
 * on a `followType` that is not `'user'`, naming the document, rather than
 * skipping it. A skipped edge is a relational link lost in silence; a throw is
 * the one scenario this typed table does not cover announcing itself. Every
 * write path in the package hard-codes `FollowType.USER`, so the expected count
 * of offenders is zero — which is exactly why a silent filter would never be
 * noticed if it were wrong.
 *
 * ## Coordinates are ported by NAME, which is the fix
 *
 * Mongo stored `coordinates: { lat, lon }` and indexed it `2dsphere`, which
 * reads an object's fields POSITIONALLY as `[longitude, latitude]` — so the
 * live index has had every point transposed. The DATA was never wrong; the
 * INDEX read it wrong. Mapping `coordinates.lat` → `latitude` and
 * `coordinates.lon` → `longitude` by name is therefore the whole fix, and
 * `user_locations.geo` derives the point from the named columns so the
 * transposition cannot come back.
 *
 * ## Rows whose source carries no timestamp
 *
 * `date(doc, 'createdAt') ?? new Date(0)` is the house pattern for a
 * `NOT NULL DEFAULT now()` timestamp: the epoch is unmistakably "not known",
 * where omitting the key would stamp the migration's own clock onto the row and
 * claim a recency that is simply false. Where a child row HAS a real timestamp
 * of its own (`authMethods[].linkedAt`, `verifiedDomains[].verifiedAt`) that
 * value is used for `created_at` too, because it is the instant the row came
 * into being rather than a stand-in for it.
 */

import {
  DEFAULT_USER_LANGUAGES,
  blocks,
  bookmarks,
  contacts,
  notifications,
  randomUserColor,
  restrictions,
  userAnalytics,
  userAncestors,
  userAppData,
  userAuthMethods,
  userFollows,
  userLinkMetadata,
  userLocations,
  userNodes,
  userVerifiedDomains,
  users,
} from '../../schema';
import { INFLUENCE_MIN } from '../../../utils/reputation.constants';
import type { CollectionPlan } from '../plan';
import { buildRow } from '../rowBuilder';
import {
  BackfillValueError,
  childRowId,
  at,
  bool,
  date,
  describeId,
  id,
  int,
  num,
  numberMap,
  ownId,
  reqDate,
  reqId,
  reqStr,
  str,
  strArray,
  subdocuments,
  type MongoDocument,
} from '../values';

/**
 * The only `followType` `user_follows` can represent — see the header and
 * `schema/userFollows.ts`.
 */
const FOLLOW_TYPE_USER = 'user';

/**
 * A subdocument's own `_id` when it has one, and a DERIVED id when it does not.
 *
 * Mongoose adds an `_id` to every subdocument-array element unless the
 * subschema opts out, so most of these ids exist and rule 1 (copied verbatim,
 * zero remapping) applies to them exactly as it does to a top-level document.
 *
 * REFUSING an element without one would be wrong, though, and this file used to
 * do it: `users.linksMetadata` is written from scraped page metadata, and an
 * array replaced through a path that bypasses schema casting carries no `_id`
 * at all. That is a legitimate production shape, not corruption — and none of
 * these five child tables' ids is referenced by any foreign key, so there is no
 * relational link to lose. `childRowId` derives a stable id from the parent, the
 * path and the ordinal, which is also what keeps a re-run idempotent.
 */
function subdocumentId(
  entry: MongoDocument,
  path: string,
  parentId: string,
  ordinal: number
): string {
  return childRowId(entry, parentId, path, ordinal);
}

export const USERS_SOCIAL_PLANS: readonly CollectionPlan[] = [
  // ---------------------------------------------------------------------------
  // users — 81 emitted columns plus five child tables
  // ---------------------------------------------------------------------------
  {
    collection: 'users',
    table: users,
    childTables: [
      userLocations,
      userAuthMethods,
      userVerifiedDomains,
      userAncestors,
      userLinkMetadata,
    ],
    enumAudits: [
      { path: 'kind', column: users.kind, absentAs: 'personal' },
      // Nullable in both schemas: an absent value stays NULL rather than being
      // defaulted, so there is no substitute value to declare.
      { path: 'organizationCategory', column: users.organizationCategory },
      { path: 'accountStatus', column: users.accountStatus, absentAs: 'active' },
      { path: 'type', column: users.type, absentAs: 'local' },
      { path: 'reputationTier', column: users.reputationTier, absentAs: 'new' },
      { path: 'userPreferences.theme', column: users.preferenceTheme, absentAs: 'system' },
      // Also nullable — and additionally forced to NULL when the sibling
      // `colorPreset` is missing or blank, per `users_theme_preference_check`.
      { path: 'themePreference.mode', column: users.themePreferenceMode },
      // Array paths: `distinct('locations.type')` reports the values across every
      // element of every document's array, which is exactly the set the child
      // table's CHECK will see.
      { path: 'locations.type', column: userLocations.type, absentAs: 'other' },
      { path: 'authMethods.type', column: userAuthMethods.type },
      { path: 'verifiedDomains.method', column: userVerifiedDomains.method },
    ],
    uniquenessAudits: [
      // Mongo indexed all three case-SENSITIVELY. Postgres does not, so two
      // accounts differing only by case collide — which is the correct outcome
      // (the application cannot tell them apart today either), and this audit is
      // what turns a `23505` naming an index into a report naming the pair.
      //
      // The audit reproduces the real expression exactly: `lower(btrim(...))`.
      // `lower(btrim(...))`, and `UniquenessAudit` can model the case half only.
      // A pair differing only by surrounding whitespace passes this audit and
      // still fails the index.
      {
        index: 'users_lower_username_key',
        key: [
          { path: 'username', normalize: 'lower-btrim' },
        ],
      },
      {
        index: 'users_lower_email_key',
        key: [
          { path: 'email', normalize: 'lower-btrim' },
        ],
      },
      {
        index: 'users_lower_public_key_key',
        key: [
          { path: 'publicKey', normalize: 'lower-btrim' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);

      // A theme preference is whole or absent — `users_theme_preference_check`.
      // A partial subdocument, or one whose `colorPreset` is the empty string
      // Mongoose would have stored, maps to (NULL, NULL): the same value
      // `toThemePreference` already produces for one at the serializer.
      const themeMode = str(doc, 'themePreference.mode');
      const themeColorPreset = str(doc, 'themePreference.colorPreset');
      const hasThemePreference =
        themeMode !== null && themeColorPreset !== null && themeColorPreset.length > 0;

      // Mongoose defaulted this to `''` and every reader tested truthiness; the
      // column's own doc comment states the ported read is
      // `auto_forward_to is not null`, which `''` would satisfy for every
      // account that never configured forwarding. So blank becomes NULL here —
      // the one place in this file where a stored value is normalized rather
      // than copied.
      const autoForwardTo = str(doc, 'autoForwardTo');

      emit(
        users,
        buildRow(
          users,
          {
            id: documentId,

            // ---- identifiers ------------------------------------------------
            username: str(doc, 'username'),
            email: str(doc, 'email'),
            phone: str(doc, 'phone'),
            // `hashedEmail` / `hashedPhone` are GENERATED — never emitted.
            publicKey: str(doc, 'publicKey'),
            refreshToken: str(doc, 'refreshToken'),

            // ---- name -------------------------------------------------------
            nameFirst: str(doc, 'name.first'),
            nameLast: str(doc, 'name.last'),

            // ---- account graph ----------------------------------------------
            kind: str(doc, 'kind') ?? 'personal',
            organizationCategory: str(doc, 'organizationCategory'),
            parentAccountId: id(doc, 'parentAccountId'),
            rootAccountId: id(doc, 'rootAccountId'),
            accountStatus: str(doc, 'accountStatus') ?? 'active',

            // ---- federation / automation ------------------------------------
            type: str(doc, 'type') ?? 'local',
            federationActorUri: str(doc, 'federation.actorUri'),
            federationDomain: str(doc, 'federation.domain'),
            // A `FederatedActor._id` in the CONSUMING app's database, and a
            // plain `text` column with no foreign key here — so it is read as a
            // string, not as an id this database will ever resolve.
            federationActorId: str(doc, 'federation.actorId'),
            federationLastAvatarFetchedAt: date(doc, 'federation.lastAvatarFetchedAt'),
            federationAvatarETag: str(doc, 'federation.avatarETag'),
            federationAvatarLastModified: str(doc, 'federation.avatarLastModified'),
            federationLastResolvedAt: date(doc, 'federation.lastResolvedAt'),
            federationUnavailableAt: date(doc, 'federation.unavailableAt'),
            federationUnavailableReason: str(doc, 'federation.unavailableReason'),
            // Declared `String` in Mongoose but holding a user id, and it DOES
            // carry a foreign key here — so `id()`, which also normalizes an
            // ObjectId if one was ever written through a casting path.
            automationOwnerId: id(doc, 'automation.ownerId'),

            // ---- standing ---------------------------------------------------
            verified: bool(doc, 'verified') ?? false,
            reputationRankWeight: num(doc, 'reputationRankWeight') ?? INFLUENCE_MIN,
            reputationTier: str(doc, 'reputationTier') ?? 'new',
            isStaff: bool(doc, 'isStaff') ?? false,
            isSeedVerifier: bool(doc, 'isSeedVerifier') ?? false,
            isSensitive: bool(doc, 'isSensitive') ?? false,
            languages: strArray(doc, 'languages') ?? [...DEFAULT_USER_LANGUAGES],

            // ---- profile ----------------------------------------------------
            avatar: str(doc, 'avatar'),
            // Both schemas generate this in the APPLICATION, and both pick a
            // random non-premium preset. Written explicitly rather than left to
            // the column's `$defaultFn` so the choice is visible here.
            color: str(doc, 'color') ?? randomUserColor(),
            bio: str(doc, 'bio'),
            description: str(doc, 'description'),
            address: str(doc, 'address'),
            birthday: str(doc, 'birthday'),
            links: strArray(doc, 'links'),
            accountExpiresAfterInactivityDays: int(
              doc,
              'accountExpiresAfterInactivityDays'
            ),

            // ---- privacy settings -------------------------------------------
            privacyIsPrivateAccount:
              bool(doc, 'privacySettings.isPrivateAccount') ?? false,
            privacyHideOnlineStatus:
              bool(doc, 'privacySettings.hideOnlineStatus') ?? false,
            privacyHideLastSeen: bool(doc, 'privacySettings.hideLastSeen') ?? false,
            privacyProfileVisibility:
              bool(doc, 'privacySettings.profileVisibility') ?? true,
            privacyLoginAlerts: bool(doc, 'privacySettings.loginAlerts') ?? true,
            privacyBlockScreenshots:
              bool(doc, 'privacySettings.blockScreenshots') ?? false,
            privacyLogin: bool(doc, 'privacySettings.login') ?? true,
            privacyBiometricLogin: bool(doc, 'privacySettings.biometricLogin') ?? false,
            privacyShowActivity: bool(doc, 'privacySettings.showActivity') ?? true,
            privacyAllowTagging: bool(doc, 'privacySettings.allowTagging') ?? true,
            privacyAllowMentions: bool(doc, 'privacySettings.allowMentions') ?? true,
            privacyHideReadReceipts:
              bool(doc, 'privacySettings.hideReadReceipts') ?? false,
            privacyAllowDirectMessages:
              bool(doc, 'privacySettings.allowDirectMessages') ?? true,
            privacyDataSharing: bool(doc, 'privacySettings.dataSharing') ?? true,
            privacyLocationSharing:
              bool(doc, 'privacySettings.locationSharing') ?? false,
            privacyAnalyticsSharing:
              bool(doc, 'privacySettings.analyticsSharing') ?? true,
            privacySensitiveContent:
              bool(doc, 'privacySettings.sensitiveContent') ?? false,
            privacyAutoFilter: bool(doc, 'privacySettings.autoFilter') ?? true,
            privacyMuteKeywords: bool(doc, 'privacySettings.muteKeywords') ?? false,
            privacyDiscoverableByEmail:
              bool(doc, 'privacySettings.discoverableByEmail') ?? false,
            privacyDiscoverableByPhone:
              bool(doc, 'privacySettings.discoverableByPhone') ?? false,
            privacyFediverseSharing:
              bool(doc, 'privacySettings.fediverseSharing') ?? true,

            // ---- email settings ---------------------------------------------
            emailSignature: str(doc, 'emailSignature'),
            autoReplyEnabled: bool(doc, 'autoReply.enabled') ?? false,
            autoReplySubject: str(doc, 'autoReply.subject'),
            autoReplyBody: str(doc, 'autoReply.body'),
            autoReplyStartDate: date(doc, 'autoReply.startDate'),
            autoReplyEndDate: date(doc, 'autoReply.endDate'),
            autoForwardTo: autoForwardTo === null || autoForwardTo.length === 0
              ? null
              : autoForwardTo,
            autoForwardKeepCopy: bool(doc, 'autoForwardKeepCopy') ?? true,

            // ---- notification channels --------------------------------------
            notificationPushEnabled:
              bool(doc, 'notificationPreferences.pushEnabled') ?? true,
            notificationEmailDigest:
              bool(doc, 'notificationPreferences.emailDigest') ?? true,
            notificationSecurityAlerts:
              bool(doc, 'notificationPreferences.securityAlerts') ?? true,
            notificationMarketingEmails:
              bool(doc, 'notificationPreferences.marketingEmails') ?? false,

            // ---- app-wide preferences ---------------------------------------
            preferenceLanguage: str(doc, 'userPreferences.language'),
            preferenceTheme: str(doc, 'userPreferences.theme') ?? 'system',
            preferenceReduceMotion:
              bool(doc, 'userPreferences.reduceMotion') ?? false,
            preferenceTimezone: str(doc, 'userPreferences.timezone'),

            // ---- portable theme preference ----------------------------------
            themePreferenceMode: hasThemePreference ? themeMode : null,
            themePreferenceColorPreset: hasThemePreference ? themeColorPreset : null,

            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // ---- locations ------------------------------------------------------
      for (const [location, ordinal] of subdocuments(doc, 'locations')) {
        const path = `locations[${ordinal}]`;
        // Read by NAME — the transposition lived in the 2dsphere index, never
        // in the stored fields. See the header.
        const latitude = num(location, 'coordinates.lat');
        const longitude = num(location, 'coordinates.lon');
        if ((latitude === null) !== (longitude === null)) {
          // Mongo permitted `{ lat }` with no `lon`;
          // `user_locations_coordinates_complete_check` does not. Refusing here
          // names the account and the element — writing the surviving half away
          // as NULL would silently discard a value the profile displays, and
          // letting it through would fail the CHECK naming only the constraint.
          throw new BackfillValueError(
            `${path}.coordinates`,
            `holds half a coordinate (lat=${JSON.stringify(latitude)}, ` +
              `lon=${JSON.stringify(longitude)}); ` +
              'user_locations_coordinates_complete_check refuses the pair',
            documentId
          );
        }
        emit(
          userLocations,
          buildRow(
            userLocations,
            {
              id: subdocumentId(location, path, documentId, ordinal),
              userId: documentId,
              // The client-supplied handle every call site addresses the row
              // by. Distinct from the subdocument's `_id` above.
              locationKey: reqStr(location, 'id'),
              name: reqStr(location, 'name'),
              label: str(location, 'label'),
              type: str(location, 'type') ?? 'other',

              street: str(location, 'address.street'),
              streetNumber: str(location, 'address.streetNumber'),
              streetDetails: str(location, 'address.streetDetails'),
              postalCode: str(location, 'address.postalCode'),
              city: str(location, 'address.city'),
              state: str(location, 'address.state'),
              country: str(location, 'address.country'),
              formattedAddress: str(location, 'address.formattedAddress'),

              latitude,
              longitude,
              // `geo` is GENERATED from the pair above — never emitted.

              placeId: str(location, 'metadata.placeId'),
              osmId: str(location, 'metadata.osmId'),
              osmType: str(location, 'metadata.osmType'),
              countryCode: str(location, 'metadata.countryCode'),
              timezone: str(location, 'metadata.timezone'),
              // `searchVector` is GENERATED — never emitted.

              createdAt: date(location, 'createdAt') ?? new Date(0),
              updatedAt: date(location, 'updatedAt') ?? new Date(0),
            },
            documentId
          )
        );
      }

      // ---- auth methods ---------------------------------------------------
      for (const [method, ordinal] of subdocuments(doc, 'authMethods')) {
        // The row came into being when the method was linked, so `linked_at` is
        // `created_at` rather than a stand-in for it.
        const linkedAt = date(method, 'linkedAt') ?? new Date(0);
        emit(
          userAuthMethods,
          buildRow(
            userAuthMethods,
            {
              id: subdocumentId(method, `authMethods[${ordinal}]`, documentId, ordinal),
              userId: documentId,
              type: reqStr(method, 'type'),
              linkedAt,
              methodPublicKey: str(method, 'metadata.publicKey'),
              methodEmail: str(method, 'metadata.email'),
              // `credentialID` in Mongo, `method_credential_id` here.
              methodCredentialId: str(method, 'metadata.credentialID'),
              methodName: str(method, 'metadata.name'),
              createdAt: linkedAt,
            },
            documentId
          )
        );
      }

      // ---- verified domains -----------------------------------------------
      for (const [domain, ordinal] of subdocuments(doc, 'verifiedDomains')) {
        const verifiedAt = reqDate(domain, 'verifiedAt');
        emit(
          userVerifiedDomains,
          buildRow(
            userVerifiedDomains,
            {
              id: subdocumentId(domain, `verifiedDomains[${ordinal}]`, documentId, ordinal),
              userId: documentId,
              domain: reqStr(domain, 'domain'),
              verifiedAt,
              method: reqStr(domain, 'method'),
              // The badge exists from the instant the proof passed.
              createdAt: verifiedAt,
            },
            documentId
          )
        );
      }

      // ---- ancestors ------------------------------------------------------
      // `[...parent.ancestors, parent._id]` — ordered ROOT FIRST, so the array
      // index IS `depth` and `depth = 0` is the tree root
      // (`schema/userAncestors.ts`). A path deeper than `MAX_ACCOUNT_DEPTH`
      // fails `user_ancestors_depth_check`, which is the intended outcome.
      const ancestors = strArray(doc, 'ancestors') ?? [];
      for (const [depth, ancestorId] of ancestors.entries()) {
        emit(
          userAncestors,
          buildRow(
            userAncestors,
            {
              userId: documentId,
              depth,
              ancestorId,
            },
            documentId
          )
        );
      }

      // ---- link metadata --------------------------------------------------
      for (const [link, position] of subdocuments(doc, 'linksMetadata')) {
        emit(
          userLinkMetadata,
          buildRow(
            userLinkMetadata,
            {
              id: subdocumentId(link, `linksMetadata[${position}]`, documentId, position),
              userId: documentId,
              // The array's order is user-chosen and visible on the profile.
              position,
              url: reqStr(link, 'url'),
              title: reqStr(link, 'title'),
              description: reqStr(link, 'description'),
              image: str(link, 'image'),
              // The subschema carries no timestamps of its own and the parent's
              // describe the ACCOUNT, not the preview — so the epoch sentinel
              // rather than a plausible-looking fabrication.
              createdAt: new Date(0),
              updatedAt: new Date(0),
            },
            documentId
          )
        );
      }
    },
  },

  // ---------------------------------------------------------------------------
  // follows — the assertion, not a filter
  // ---------------------------------------------------------------------------
  {
    collection: 'follows',
    table: userFollows,
    transform(doc, emit) {
      const documentId = ownId(doc);

      const followType = reqStr(doc, 'followType');
      if (followType !== FOLLOW_TYPE_USER) {
        throw new BackfillValueError(
          'followType',
          `is ${JSON.stringify(followType)}, and \`user_follows\` can only ` +
            `represent ${JSON.stringify(FOLLOW_TYPE_USER)} edges — both its ` +
            'columns are foreign keys into `users`. Skipping the row would lose ' +
            'a relational link in silence, so the copy stops here instead. See ' +
            '`schema/userFollows.ts` for why the typed table was chosen',
          describeId(doc)
        );
      }

      emit(
        userFollows,
        buildRow(
          userFollows,
          {
            id: documentId,
            // `followerUserId` in Mongo — named for the polymorphic case, where
            // only the FOLLOWER was known to be a user.
            followerId: reqId(doc, 'followerUserId'),
            followedId: reqId(doc, 'followedId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // ---------------------------------------------------------------------------
  // blocks / restricteds / bookmarks — the append-only pair tables
  // ---------------------------------------------------------------------------
  {
    collection: 'blocks',
    table: blocks,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        blocks,
        buildRow(
          blocks,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            blockedId: reqId(doc, 'blockedId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    // The Mongo collection is `restricteds` — Mongoose's pluralisation of
    // `Restricted`. The table is named for what a row holds.
    collection: 'restricteds',
    table: restrictions,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        restrictions,
        buildRow(
          restrictions,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            restrictedId: reqId(doc, 'restrictedId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'bookmarks',
    table: bookmarks,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        bookmarks,
        buildRow(
          bookmarks,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            // Mention's `Post` id — cross-service, so no foreign key, but still
            // an id and still copied verbatim.
            postId: reqId(doc, 'postId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // ---------------------------------------------------------------------------
  // notifications
  // ---------------------------------------------------------------------------
  {
    collection: 'notifications',
    table: notifications,
    enumAudits: [
      { path: 'type', column: notifications.type },
      { path: 'entityType', column: notifications.entityType },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        notifications,
        buildRow(
          notifications,
          {
            id: documentId,
            recipientId: reqId(doc, 'recipientId'),
            actorId: reqId(doc, 'actorId'),
            type: reqStr(doc, 'type'),
            // Discriminated by `entityType`; two of its three values name rows
            // in Mention's database, so no foreign key is possible.
            entityId: reqId(doc, 'entityId'),
            entityType: reqStr(doc, 'entityType'),
            read: bool(doc, 'read') ?? false,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // ---------------------------------------------------------------------------
  // contacts
  // ---------------------------------------------------------------------------
  {
    collection: 'contacts',
    table: contacts,
    uniquenessAudits: [
      // The index is `(user_id, email)` with NO `lower()` — checked against the
      // declaration, not assumed from the Mongoose `lowercase: true` setter that
      // made it effectively case-insensitive on the write path. So the audit
      // compares both paths EXACTLY, which is what the index will do; declaring
      // `email` case-insensitive here would report pairs Postgres accepts.
      {
        index: 'contacts_user_id_email_key',
        key: [
          { path: 'userId', normalize: 'exact' },
          { path: 'email', normalize: 'exact' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        contacts,
        buildRow(
          contacts,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            name: reqStr(doc, 'name'),
            email: reqStr(doc, 'email'),
            company: str(doc, 'company'),
            notes: str(doc, 'notes'),
            starred: bool(doc, 'starred') ?? false,
            autoCollected: bool(doc, 'autoCollected') ?? false,
            lastContactedAt: date(doc, 'lastContactedAt'),
            // `searchVector` is GENERATED — never emitted.
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // ---------------------------------------------------------------------------
  // analytics — the one non-identity field-name mapping in this batch
  // ---------------------------------------------------------------------------
  {
    collection: 'analytics',
    table: userAnalytics,
    enumAudits: [{ path: 'period', column: userAnalytics.period }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        userAnalytics,
        buildRow(
          userAnalytics,
          {
            id: documentId,
            // `userID`, with a capital D, is unique to this one model.
            userId: reqId(doc, 'userID'),
            period: reqStr(doc, 'period'),
            date: reqDate(doc, 'date'),

            postViews: int(doc, 'stats.postViews') ?? 0,
            profileViews: int(doc, 'stats.profileViews') ?? 0,

            engagementLikes: int(doc, 'stats.engagement.likes') ?? 0,
            engagementReplies: int(doc, 'stats.engagement.replies') ?? 0,
            engagementReposts: int(doc, 'stats.engagement.reposts') ?? 0,
            engagementQuotes: int(doc, 'stats.engagement.quotes') ?? 0,
            engagementBookmarks: int(doc, 'stats.engagement.bookmarks') ?? 0,

            reachImpressions: int(doc, 'stats.reach.impressions') ?? 0,
            reachUniqueViewers: int(doc, 'stats.reach.uniqueViewers') ?? 0,

            // Mongoose `Map`s over an open key space. `numberMap` converts a real
            // `Map` rather than serializing it to `{}`, and checks every value —
            // the CHECK constraints only assert `jsonb_typeof(...) = 'object'`.
            demographicsCountries:
              numberMap(doc, 'stats.demographics.countries') ?? {},
            demographicsLanguages:
              numberMap(doc, 'stats.demographics.languages') ?? {},

            peakActivityHour: int(doc, 'stats.peakActivity.hour') ?? 0,
            peakActivityCount: int(doc, 'stats.peakActivity.count') ?? 0,

            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // ---------------------------------------------------------------------------
  // userappdatas — the one honest `jsonb` in this batch
  // ---------------------------------------------------------------------------
  {
    collection: 'userappdatas',
    table: userAppData,
    transform(doc, emit) {
      const documentId = ownId(doc);

      // `Schema.Types.Mixed`: ANY JSON value is legal here, not just an object —
      // a bare number, a string, an array and `null` are all things a caller may
      // have stored, and the column carries no CHECK on its type. `jsonObject`
      // would refuse every one of the non-object cases, so the value is read
      // raw. `{}` in particular must survive: Mongoose sets `minimize: false` on
      // this schema precisely so an empty object is stored rather than stripped.
      //
      // `undefined` becomes the SQL NULL the Mongoose `default: null` already
      // stood for; `buildRow` would refuse it otherwise, correctly.
      const value = at(doc, 'value');

      emit(
        userAppData,
        buildRow(
          userAppData,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            namespace: reqStr(doc, 'namespace'),
            key: reqStr(doc, 'key'),
            value: value === undefined ? null : value,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // ---------------------------------------------------------------------------
  // usernodes
  // ---------------------------------------------------------------------------
  {
    collection: 'usernodes',
    table: userNodes,
    enumAudits: [
      { path: 'mode', column: userNodes.mode, absentAs: 'pull' },
      { path: 'controller', column: userNodes.controller, absentAs: 'self' },
      { path: 'status', column: userNodes.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        userNodes,
        buildRow(
          userNodes,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            nodeDid: str(doc, 'nodeDid'),
            endpoint: reqStr(doc, 'endpoint'),
            nodePublicKey: reqStr(doc, 'nodePublicKey'),
            mode: str(doc, 'mode') ?? 'pull',
            managed: bool(doc, 'managed') ?? false,
            controller: str(doc, 'controller') ?? 'self',
            status: str(doc, 'status') ?? 'active',
            lastSeenAt: date(doc, 'lastSeenAt'),
            lastProbeAt: date(doc, 'lastProbeAt'),
            lastError: str(doc, 'lastError'),
            // The chain `seq` Oxy has mirrored up to — an integer, so a
            // fractional value throws rather than being rounded into a
            // plausible-looking cursor.
            cursor: int(doc, 'cursor'),
            lastSyncedAt: date(doc, 'lastSyncedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },
];
