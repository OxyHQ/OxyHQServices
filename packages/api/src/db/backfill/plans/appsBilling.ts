/**
 * Backfill plans for the application/developer surface and everything financial.
 *
 * Twenty collections: the `applications` hub and what hangs off it
 * (credentials, memberships, OAuth grants, API keys, usage events, cross-app
 * discovery signals, OTA channels/updates/assets), plus the six collections
 * that hold money or entitlements.
 *
 * ## Renames — where a Mongo field name does NOT survive
 *
 * Each is a rename only; no value is transformed.
 *
 * | Mongo | Postgres | Why |
 * |---|---|---|
 * | `apikeyusages.appId` | `api_key_usage_events.application_id` | every other table calls it that |
 * | `apikeyusages.timestamp` | `api_key_usage_events.created_at` | it IS the birth column (`CONVENTIONS.md`) |
 * | `developerapikeys.appId` | `developer_api_keys.application_id` | same as above |
 * | `billingsubscriptions.plan.price` | `plan_price_minor_units` | naming the unit, NOT a conversion |
 * | `billingtransactions.amount` | `amount_minor_units` | naming the unit, NOT a conversion |
 * | `appaffinityeventseens` | `app_affinity_seen_events` | the collection name was a `pluralize()` artifact |
 *
 * **Neither money column is scaled.** Both schema files record that the stored
 * value has ALWAYS been minor units — `session.amount_total` and a literal
 * `2999` for $29.99 (`routes/billing.ts:377`, `:441`, `:75`) — so a factor of
 * 100 here would be the bug the rename exists to prevent, not a fix for it. The
 * FairCoin columns (`wallets.balance`, `transactions.amount`) are the opposite
 * case: they stay decimal and go through `decimal()`, which renders them at the
 * `numeric(38, 8)` scale rather than letting a double choose.
 *
 * ## Five embedded shapes that flatten, two that become child tables
 *
 * Flattened onto the parent: `developerapikeys.rateLimit` (four columns),
 * `billingsubscriptions.plan` (four), `subscriptions.features` (six),
 * `usercredits.credits` (five), `appupdates.launchAsset` (four).
 *
 * Child tables: `appupdates.assets[]` → `app_update_assets` **with an explicit
 * `ordinal`**, because the manifest is signed and a re-read that reordered the
 * array would invalidate the signature; and `updatechannels.rollbacksToEmbedded[]`
 * → `update_channel_rollbacks`, whose `(channel, runtime, platform)` PRIMARY KEY
 * is a guarantee the Mongo array could not make — so a document carrying two
 * entries for one tuple is REFUSED here by name instead of failing later as an
 * anonymous `23505`.
 *
 * ## What deliberately does NOT travel
 *
 * - `accountmembers.permissions` — a pure derivation of `role`
 *   (`permissionsForAccountRole`), re-derived at the serializer. No column.
 * - `appusersignals.endorsementCount` — nothing reads it;
 *   `app_endorsement_edges` answers the same question directly. No column.
 * - `updateassets.s3Key` — `GENERATED ALWAYS AS ('public/updates/assets/' || sha256)`.
 *   Writing it fails with SQLSTATE `428C9`, so it is never emitted.
 * - `appendorsementedges.sourceId`'s `''` sentinel — `CONVENTIONS.md` is explicit
 *   that an empty string is a VALUE. It becomes NULL, and the unique constraint
 *   keeps the Mongo semantic through `NULLS NOT DISTINCT`.
 *
 * ## The epoch, and why it is the least-wrong default
 *
 * Every `NOT NULL` timestamp whose Mongoose counterpart carried a `Date.now`
 * default takes `?? new Date(0)`. The alternatives both assert something false:
 * omitting the key lets `DEFAULT now()` stamp the row with the BACKFILL's clock,
 * and throwing aborts a whole run over one document that predates the field.
 * The epoch is visibly not a real value, which is the property wanted here.
 */

import {
  accountCredentials,
  accountMembers,
  apiKeyUsageEvents,
  appAffinityEdges,
  appAffinitySeenEvents,
  appEndorsementEdges,
  appGrants,
  appUpdateAssets,
  appUpdates,
  appUserSignals,
  applicationCredentials,
  applications,
  billingSubscriptions,
  billingTransactions,
  DEFAULT_BILLING_CURRENCY,
  DEFAULT_DAILY_CREDIT_REFRESH,
  DEFAULT_DEVELOPER_API_KEY_SCOPES,
  DEFAULT_FREE_CREDITS,
  developerApiKeys,
  subscriptions,
  transactions,
  updateAssets,
  updateChannelRollbacks,
  updateChannels,
  userCredits,
  wallets,
} from '../../schema';
import type { CollectionPlan } from '../plan';
import { buildRow } from '../rowBuilder';
import {
  bool,
  date,
  decimal,
  id,
  int,
  jsonObject,
  num,
  ownId,
  reqDate,
  reqId,
  reqInt,
  reqJsonObject,
  reqNum,
  reqStr,
  str,
  strArray,
  subdocuments,
} from '../values';

export const APPS_BILLING_PLANS: readonly CollectionPlan[] = [
  // -------------------------------------------------------------------------
  // applications — the hub everything below hangs off
  // -------------------------------------------------------------------------
  {
    collection: 'applications',
    table: applications,
    enumAudits: [
      { path: 'type', column: applications.type, absentAs: 'third_party' },
      // The audit `plan.ts` was written for. A `status` outside the declared
      // enum HAS been written in this repo, because the update paths never set
      // `runValidators` — the Postgres CHECK is enforced, so the value has to be
      // found here rather than at hour three of the run.
      { path: 'status', column: applications.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        applications,
        buildRow(
          applications,
          {
            id: documentId,
            name: reqStr(doc, 'name'),
            description: str(doc, 'description'),
            websiteUrl: str(doc, 'websiteUrl'),
            privacyPolicyUrl: str(doc, 'privacyPolicyUrl'),
            termsUrl: str(doc, 'termsUrl'),
            icon: str(doc, 'icon'),
            type: str(doc, 'type') ?? 'third_party',
            status: str(doc, 'status') ?? 'active',
            isOfficial: bool(doc, 'isOfficial') ?? false,
            isInternal: bool(doc, 'isInternal') ?? false,
            // All three are `text[] NOT NULL DEFAULT '{}'`, and `''` is the
            // value the column defaults to — not `null`, which `strArray`
            // returns for an absent field.
            capabilities: strArray(doc, 'capabilities') ?? [],
            redirectUris: strArray(doc, 'redirectUris') ?? [],
            scopes: strArray(doc, 'scopes') ?? [],
            webhookUrl: str(doc, 'webhookUrl'),
            webhookSecret: str(doc, 'webhookSecret'),
            devWebhookUrl: str(doc, 'devWebhookUrl'),
            ownerAccountId: reqId(doc, 'ownerAccountId'),
            // NULLABLE here, relaxing Mongoose's `required`: it is attribution,
            // and a deleted creator now SETs NULL rather than dangling.
            createdByUserId: id(doc, 'createdByUserId'),
            lastUsedAt: date(doc, 'lastUsedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // credentials — the two sibling tables, application-owned and account-owned
  // -------------------------------------------------------------------------
  {
    collection: 'applicationcredentials',
    table: applicationCredentials,
    enumAudits: [
      { path: 'type', column: applicationCredentials.type },
      { path: 'environment', column: applicationCredentials.environment },
      { path: 'status', column: applicationCredentials.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        applicationCredentials,
        buildRow(
          applicationCredentials,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            name: reqStr(doc, 'name'),
            publicKey: reqStr(doc, 'publicKey'),
            // Absent for a `public` client, which holds no secret at all.
            secretHash: str(doc, 'secretHash'),
            type: reqStr(doc, 'type'),
            environment: reqStr(doc, 'environment'),
            scopes: strArray(doc, 'scopes') ?? [],
            status: str(doc, 'status') ?? 'active',
            lastUsedAt: date(doc, 'lastUsedAt'),
            // The end of the 7-day rotation grace. NOT a TTL — the row is the
            // audit trail and outlives its own deadline.
            expiresAt: date(doc, 'expiresAt'),
            // Self-referencing FK. Emitted like any other column: the runner
            // defers self-references to a second UPDATE pass.
            rotatedFromCredentialId: id(doc, 'rotatedFromCredentialId'),
            createdByUserId: id(doc, 'createdByUserId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'accountcredentials',
    table: accountCredentials,
    enumAudits: [
      // A one-value set (`service`) still gets audited: it is what would catch a
      // `confidential` — meaningful on the sibling table — written here.
      { path: 'type', column: accountCredentials.type, absentAs: 'service' },
      { path: 'environment', column: accountCredentials.environment },
      { path: 'status', column: accountCredentials.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        accountCredentials,
        buildRow(
          accountCredentials,
          {
            id: documentId,
            accountId: reqId(doc, 'accountId'),
            name: reqStr(doc, 'name'),
            publicKey: reqStr(doc, 'publicKey'),
            secretHash: str(doc, 'secretHash'),
            type: str(doc, 'type') ?? 'service',
            environment: reqStr(doc, 'environment'),
            scopes: strArray(doc, 'scopes') ?? [],
            status: str(doc, 'status') ?? 'active',
            lastUsedAt: date(doc, 'lastUsedAt'),
            expiresAt: date(doc, 'expiresAt'),
            rotatedFromCredentialId: id(doc, 'rotatedFromCredentialId'),
            createdByUserId: id(doc, 'createdByUserId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // account membership — the single RBAC table
  // -------------------------------------------------------------------------
  {
    collection: 'accountmembers',
    table: accountMembers,
    enumAudits: [
      { path: 'role', column: accountMembers.role },
      { path: 'status', column: accountMembers.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        accountMembers,
        buildRow(
          accountMembers,
          {
            id: documentId,
            accountId: reqId(doc, 'accountId'),
            memberUserId: reqId(doc, 'memberUserId'),
            role: reqStr(doc, 'role'),
            // `permissions[]` does NOT travel — every write site set it to
            // exactly `permissionsForAccountRole(role)`, and the serializer
            // re-derives it. There is no column to emit it into.
            inherit: bool(doc, 'inherit') ?? true,
            status: str(doc, 'status') ?? 'active',
            invitedByUserId: id(doc, 'invitedByUserId'),
            joinedAt: date(doc, 'joinedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // OAuth grants
  // -------------------------------------------------------------------------
  {
    collection: 'appgrants',
    table: appGrants,
    enumAudits: [],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        appGrants,
        buildRow(
          appGrants,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            applicationId: reqId(doc, 'applicationId'),
            // No CHECK on this column: a grant records what the USER consented
            // to, which may name a scope the platform has since retired.
            scopes: strArray(doc, 'scopes') ?? [],
            firstGrantedAt: date(doc, 'firstGrantedAt') ?? new Date(0),
            lastUsedAt: date(doc, 'lastUsedAt') ?? new Date(0),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // API keys and the usage events they produce
  // -------------------------------------------------------------------------
  {
    collection: 'apikeyusages',
    table: apiKeyUsageEvents,
    enumAudits: [
      { path: 'method', column: apiKeyUsageEvents.method },
      { path: 'authType', column: apiKeyUsageEvents.authType, absentAs: 'api_key' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        apiKeyUsageEvents,
        buildRow(
          apiKeyUsageEvents,
          {
            id: documentId,
            apiKeyId: id(doc, 'apiKeyId'),
            // A bare `String` in Mongoose holding a `User._id`, and a real
            // foreign key here.
            userId: reqId(doc, 'userId'),
            // RENAMED: Mongo `appId`.
            applicationId: id(doc, 'appId'),
            endpoint: reqStr(doc, 'endpoint'),
            method: reqStr(doc, 'method'),
            statusCode: reqInt(doc, 'statusCode'),
            tokensUsed: int(doc, 'tokensUsed') ?? 0,
            creditsUsed: num(doc, 'creditsUsed') ?? 0,
            responseTime: num(doc, 'responseTime'),
            // `ipAddress` was removed from the Mongoose model under the
            // no-user-IPs-at-rest invariant. There is no column, so a stale
            // production document carrying one does not travel.
            userAgent: str(doc, 'userAgent'),
            authType: str(doc, 'authType') ?? 'api_key',
            serviceApp: str(doc, 'serviceApp'),
            // RENAMED: Mongo `timestamp`, which was this row's birth column and
            // nothing else. There is no `updated_at` — the absence IS the
            // append-only contract.
            createdAt: date(doc, 'timestamp') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'developerapikeys',
    table: developerApiKeys,
    enumAudits: [],
    transform(doc, emit) {
      const documentId = ownId(doc);
      // The four rate-limit columns are omitted WHOLESALE when `rateLimit` is
      // absent, so Postgres applies the same defaults Mongoose's object default
      // carried. Supplying `null` instead would turn a document written before
      // the field into a key with NO daily request limit, since NULL is what
      // "unlimited" means in every one of these columns.
      const rateLimit = jsonObject(doc, 'rateLimit');
      emit(
        developerApiKeys,
        buildRow(
          developerApiKeys,
          {
            id: documentId,
            // A bare `String` in Mongoose holding a `User._id`.
            userId: reqId(doc, 'userId'),
            // RENAMED: Mongo `appId`.
            applicationId: reqId(doc, 'appId'),
            name: reqStr(doc, 'name'),
            keyHash: reqStr(doc, 'keyHash'),
            keyPrefix: reqStr(doc, 'keyPrefix'),
            scopes: strArray(doc, 'scopes') ?? [...DEFAULT_DEVELOPER_API_KEY_SCOPES],
            // Mongoose stored an explicit `null` for "never expires"; the
            // nullable column says the same thing.
            expiresAt: date(doc, 'expiresAt'),
            lastUsedAt: date(doc, 'lastUsedAt'),
            isActive: bool(doc, 'isActive') ?? true,
            ...(rateLimit === null
              ? {}
              : {
                  rateLimitRequestsPerMinute: int(doc, 'rateLimit.requestsPerMinute'),
                  rateLimitRequestsPerDay: int(doc, 'rateLimit.requestsPerDay'),
                  rateLimitTokensPerMinute: int(doc, 'rateLimit.tokensPerMinute'),
                  rateLimitTokensPerDay: int(doc, 'rateLimit.tokensPerDay'),
                }),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // cross-app discovery signals
  // -------------------------------------------------------------------------
  {
    collection: 'appusersignals',
    table: appUserSignals,
    enumAudits: [],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        appUserSignals,
        buildRow(
          appUserSignals,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            userId: reqId(doc, 'userId'),
            // Signed, and deliberately not clamped: a `remove` subtracts the
            // weight that was added, and float arithmetic can leave a small
            // negative residue after an add/remove cycle.
            endorsementScore: num(doc, 'endorsementScore') ?? 0,
            interestScore: num(doc, 'interestScore') ?? 0,
            // `endorsementCount` does NOT travel: nothing reads it, and
            // `app_endorsement_edges` answers the same question directly.
            lastEndorsedAt: date(doc, 'lastEndorsedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'appaffinityedges',
    table: appAffinityEdges,
    enumAudits: [],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        appAffinityEdges,
        buildRow(
          appAffinityEdges,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            fromUserId: reqId(doc, 'fromUserId'),
            toUserId: reqId(doc, 'toUserId'),
            affinity: num(doc, 'affinity') ?? 0,
            // Nullable with NO default on both sides: an edge created before its
            // first fold genuinely has no decay reference point, and `now()`
            // would claim a fold that did not happen.
            lastEventAt: date(doc, 'lastEventAt'),
            eventCount: int(doc, 'eventCount') ?? 0,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    // Mongoose's `pluralize()` produced `appaffinityeventseens`, which is not a
    // word. The LIVE collection name is what goes here; the table is named for
    // what it holds.
    collection: 'appaffinityeventseens',
    table: appAffinitySeenEvents,
    enumAudits: [],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        appAffinitySeenEvents,
        buildRow(
          appAffinitySeenEvents,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            eventId: reqStr(doc, 'eventId'),
            // The only timestamp: the model set `timestamps: false` so the TTL
            // index could key off this column.
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'appendorsementedges',
    table: appEndorsementEdges,
    enumAudits: [],
    transform(doc, emit) {
      const documentId = ownId(doc);
      // Mongo stored `''` for "the app named no source object", because the
      // field is part of the idempotency key and `''` made the compound unique
      // index behave. The sentinel does not travel: NULL is "unset", and the
      // constraint keeps the Mongo semantic through `NULLS NOT DISTINCT`. A
      // CHECK rejects `''`, so this mapping is mandatory, not cosmetic.
      const sourceId = str(doc, 'sourceId');
      emit(
        appEndorsementEdges,
        buildRow(
          appEndorsementEdges,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            ownerId: reqId(doc, 'ownerId'),
            memberId: reqId(doc, 'memberId'),
            sourceId: sourceId === '' ? null : sourceId,
            // The owner's ranking weight frozen at apply time, so a later
            // `remove` subtracts exactly what was added.
            weight: reqNum(doc, 'weight'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // Oxy Updates — channels, updates, assets
  // -------------------------------------------------------------------------
  {
    collection: 'appupdates',
    table: appUpdates,
    childTables: [appUpdateAssets],
    enumAudits: [
      { path: 'platform', column: appUpdates.platform },
      { path: 'status', column: appUpdates.status, absentAs: 'published' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        appUpdates,
        buildRow(
          appUpdates,
          {
            id: documentId,
            // A UUIDv4 the expo-updates client PARSES, so it is a
            // client-visible contract and a separate column from the row's id.
            updateId: reqStr(doc, 'updateId'),
            applicationId: reqId(doc, 'applicationId'),
            channelId: reqId(doc, 'channelId'),
            runtimeVersion: reqStr(doc, 'runtimeVersion'),
            platform: reqStr(doc, 'platform'),
            status: str(doc, 'status') ?? 'published',
            // `launchAsset` is exactly one, always present, with a closed
            // four-field shape — four real columns.
            launchAssetSha256: reqStr(doc, 'launchAsset.sha256'),
            launchAssetKey: reqStr(doc, 'launchAsset.key'),
            launchAssetContentType: reqStr(doc, 'launchAsset.contentType'),
            launchAssetFileExtension: str(doc, 'launchAsset.fileExtension'),
            // Embedded verbatim in the signed manifest. A CHECK requires
            // `extra.expoClient`, which the Mongoose validator only enforced on
            // the paths that ran it — so a document without it stops the run.
            extra: reqJsonObject(doc, 'extra'),
            metadata: jsonObject(doc, 'metadata') ?? {},
            rolloutPercent: int(doc, 'rolloutPercent') ?? 100,
            gitCommit: str(doc, 'gitCommit'),
            gitBranch: str(doc, 'gitBranch'),
            message: str(doc, 'message'),
            // A plain string in Mongo and a self-reference through
            // `app_updates.update_id` here — the public handle, not the row id.
            promotedFromUpdateId: str(doc, 'promotedFromUpdateId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // The manifest is SIGNED and a device may fetch any historical update, so
      // the bytes a given `update_id` produces must be identical forever.
      // `ordinal` is the array position, carried explicitly: without it a
      // re-read could return these descriptors in a different order and
      // invalidate the signature.
      for (const [asset, ordinal] of subdocuments(doc, 'assets')) {
        emit(
          appUpdateAssets,
          buildRow(
            appUpdateAssets,
            {
              appUpdateId: documentId,
              ordinal,
              sha256: reqStr(asset, 'sha256'),
              key: reqStr(asset, 'key'),
              contentType: reqStr(asset, 'contentType'),
              fileExtension: str(asset, 'fileExtension'),
            },
            documentId
          )
        );
      }
    },
  },

  {
    collection: 'updateassets',
    table: updateAssets,
    enumAudits: [{ path: 'status', column: updateAssets.status, absentAs: 'pending' }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        updateAssets,
        buildRow(
          updateAssets,
          {
            id: documentId,
            sha256: reqStr(doc, 'sha256'),
            // `s3Key` is NOT emitted: it is
            // `GENERATED ALWAYS AS ('public/updates/assets/' || sha256) STORED`,
            // and writing it fails with SQLSTATE `428C9`. Postgres derives the
            // same value Mongo stored.
            contentType: reqStr(doc, 'contentType'),
            size: reqInt(doc, 'size'),
            status: str(doc, 'status') ?? 'pending',
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'updatechannels',
    table: updateChannels,
    childTables: [updateChannelRollbacks],
    // The path traverses the embedded array; `distinct()` on it returns the
    // element values, which is exactly the closed set the child table's CHECK
    // constrains.
    enumAudits: [{ path: 'rollbacksToEmbedded.platform', column: updateChannelRollbacks.platform }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        updateChannels,
        buildRow(
          updateChannels,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            name: reqStr(doc, 'name'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // `(channel_id, runtime_version, platform)` is the child table's PRIMARY
      // KEY — a guarantee the Mongo array could not make, since the write was a
      // `$pull` followed by a `$push` and two concurrent rollbacks could leave
      // two entries for one tuple. Refusing the document by NAME here is worth
      // more than the anonymous `23505` the insert would raise later.
      const seen = new Set<string>();
      for (const [rollback] of subdocuments(doc, 'rollbacksToEmbedded')) {
        const runtimeVersion = reqStr(rollback, 'runtimeVersion');
        const platform = reqStr(rollback, 'platform');
        const key = JSON.stringify([runtimeVersion, platform]);
        if (seen.has(key)) {
          throw new Error(
            `updatechannels ${documentId}: rollbacksToEmbedded holds two entries for ` +
              `(${runtimeVersion}, ${platform}), which update_channel_rollbacks makes a ` +
              'PRIMARY KEY — resolve the duplicate in Mongo before the copy'
          );
        }
        seen.add(key);

        emit(
          updateChannelRollbacks,
          buildRow(
            updateChannelRollbacks,
            {
              channelId: documentId,
              runtimeVersion,
              platform,
              // Part of the served manifest, not bookkeeping: a client rolls
              // back only when the update it is running predates this instant.
              commitTime: reqDate(rollback, 'commitTime'),
            },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // Stripe — the subscription mirror and this platform's own money trail
  // -------------------------------------------------------------------------
  {
    collection: 'billingsubscriptions',
    table: billingSubscriptions,
    // The Postgres value set is WIDER than Mongoose's, because the webhook wrote
    // through `findOneAndUpdate` without `runValidators` and Stripe really does
    // send `incomplete`, `incomplete_expired` and `paused`. The audit still runs:
    // a value outside even the widened set would fail the CHECK.
    enumAudits: [{ path: 'status', column: billingSubscriptions.status, absentAs: 'active' }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        billingSubscriptions,
        buildRow(
          billingSubscriptions,
          {
            id: documentId,
            // A bare `String` in Mongoose holding a `User._id`.
            userId: reqId(doc, 'userId'),
            stripeCustomerId: reqStr(doc, 'stripeCustomerId'),
            stripeSubscriptionId: reqStr(doc, 'stripeSubscriptionId'),
            stripePriceId: reqStr(doc, 'stripePriceId'),
            status: str(doc, 'status') ?? 'active',
            currentPeriodStart: reqDate(doc, 'currentPeriodStart'),
            currentPeriodEnd: reqDate(doc, 'currentPeriodEnd'),
            cancelAtPeriodEnd: bool(doc, 'cancelAtPeriodEnd') ?? false,
            // `plan` was an embedded object with a fully known shape: four real
            // columns, a SNAPSHOT taken at webhook time.
            planName: reqStr(doc, 'plan.name'),
            planCreditsPerMonth: reqInt(doc, 'plan.creditsPerMonth'),
            // RENAMED, NOT converted. `plan.price` has always held minor units
            // (`billing.ts:75` writes a literal `2999` for $29.99); the column
            // name states the unit the value already carries.
            planPriceMinorUnits: reqInt(doc, 'plan.price'),
            planCurrency: str(doc, 'plan.currency') ?? DEFAULT_BILLING_CURRENCY,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'billingtransactions',
    table: billingTransactions,
    enumAudits: [
      { path: 'type', column: billingTransactions.type },
      { path: 'status', column: billingTransactions.status, absentAs: 'pending' },
    ],
    uniquenessAudits: [
      // NEW: Mongo had no index here at all, so a replayed
      // `checkout.session.completed` granted credits twice and wrote a second
      // receipt. A collision is therefore an INCIDENT to look at, not a
      // cosmetic clash.
      //
      // The real index is PARTIAL (`type = 'credit_purchase' and
      // stripe_payment_intent_id is not null`) and an audit cannot carry a
      // predicate, so this is BROADER than the constraint: every pair the index
      // would reject is reported, plus pairs of some other `type`. Check a
      // reported pair against the predicate before acting on it.
      {
        index: 'billing_transactions_payment_intent_key',
        key: [
          { path: 'stripePaymentIntentId', normalize: 'exact' },
          { path: 'type', normalize: 'exact' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        billingTransactions,
        buildRow(
          billingTransactions,
          {
            id: documentId,
            // A bare `String` in Mongoose holding a `User._id`.
            userId: reqId(doc, 'userId'),
            stripeCustomerId: str(doc, 'stripeCustomerId'),
            stripePaymentIntentId: str(doc, 'stripePaymentIntentId'),
            stripeSubscriptionId: str(doc, 'stripeSubscriptionId'),
            stripeSubscriptionPeriodStart: date(doc, 'stripeSubscriptionPeriodStart'),
            type: reqStr(doc, 'type'),
            // RENAMED, NOT converted — same as `plan_price_minor_units` above.
            // Every writer already puts minor units in it.
            amountMinorUnits: reqInt(doc, 'amount'),
            currency: str(doc, 'currency') ?? DEFAULT_BILLING_CURRENCY,
            credits: reqInt(doc, 'credits'),
            status: str(doc, 'status') ?? 'pending',
            description: str(doc, 'description'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // the legacy entitlement record
  // -------------------------------------------------------------------------
  {
    collection: 'subscriptions',
    table: subscriptions,
    enumAudits: [
      { path: 'plan', column: subscriptions.plan, absentAs: 'basic' },
      { path: 'status', column: subscriptions.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        subscriptions,
        buildRow(
          subscriptions,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            plan: str(doc, 'plan') ?? 'basic',
            status: str(doc, 'status') ?? 'active',
            startDate: reqDate(doc, 'startDate'),
            // Mongo had a TTL index on this column, which DELETED the record of
            // what the user bought the moment the period closed. It does not
            // travel — expired rows are copied exactly as found, and expiry is
            // derived from this column instead.
            endDate: reqDate(doc, 'endDate'),
            autoRenew: bool(doc, 'autoRenew') ?? true,
            paymentMethod: str(doc, 'paymentMethod'),
            latestInvoice: str(doc, 'latestInvoice'),
            // `features` was an embedded object with a fully known shape: six
            // real columns, reassembled by the serializer.
            featureAnalytics: bool(doc, 'features.analytics') ?? false,
            featurePremiumBadge: bool(doc, 'features.premiumBadge') ?? false,
            featureUnlimitedFollowing: bool(doc, 'features.unlimitedFollowing') ?? false,
            featureHigherUploadLimits: bool(doc, 'features.higherUploadLimits') ?? false,
            featurePromotedPosts: bool(doc, 'features.promotedPosts') ?? false,
            featureBusinessTools: bool(doc, 'features.businessTools') ?? false,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // the FairCoin wallet and its ledger
  // -------------------------------------------------------------------------
  {
    collection: 'transactions',
    table: transactions,
    enumAudits: [
      { path: 'type', column: transactions.type },
      { path: 'status', column: transactions.status, absentAs: 'pending' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        transactions,
        buildRow(
          transactions,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            type: reqStr(doc, 'type'),
            // `numeric(38, 8)`, matching `wallets.balance` — a debit compared
            // against a balance of a different scale starts rounding at the
            // comparison. `decimal()` renders at that scale rather than letting
            // the driver pick a double's representation.
            amount: decimal(doc, 'amount'),
            status: str(doc, 'status') ?? 'pending',
            description: str(doc, 'description'),
            // NULL means the movement had no counterparty (a deposit,
            // withdrawal or purchase), which is why the FK is `RESTRICT` rather
            // than `SET NULL`.
            recipientId: id(doc, 'recipientId'),
            itemId: str(doc, 'itemId'),
            itemType: str(doc, 'itemType'),
            externalReference: str(doc, 'externalReference'),
            completedAt: date(doc, 'completedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'wallets',
    table: wallets,
    enumAudits: [],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        wallets,
        buildRow(
          wallets,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            // Mongo stored an IEEE-754 double, which cannot represent `0.1`.
            // `decimal()` fixes the scale the `numeric(38, 8)` column declares
            // instead of letting the driver choose a representation.
            balance: decimal(doc, 'balance') ?? '0',
            address: str(doc, 'address'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // API credits — the one table whose Mongo `_id` is already the user id
  // -------------------------------------------------------------------------
  {
    collection: 'usercredits',
    table: userCredits,
    enumAudits: [],
    uniquenessAudits: [
      // Mongo's index on this column was sparse but NOT unique, and
      // `billing.ts:387` resolves a subscription webhook's account with
      // `findOne({stripeCustomerId})` — a `findOne` IS a uniqueness assumption.
      // Two accounts sharing a customer id would credit whichever row came back
      // first, so the pair has to be found before the copy rather than after.
      {
        index: 'user_credits_stripe_customer_id_key',
        key: [
          { path: 'stripeCustomerId', normalize: 'exact' },
        ],
      },
    ],
    transform(doc, emit) {
      // `UserCredits._id` is a String holding the user id verbatim — the row is
      // upserted on it — so this table is a 1:1 extension of `users` whose
      // PRIMARY KEY is `user_id`. There is no separate `id` column to fill.
      const documentId = ownId(doc);
      emit(
        userCredits,
        buildRow(
          userCredits,
          {
            userId: documentId,
            // `credits` was an embedded object with a fully known shape: five
            // real columns. Whole counts, so `int` — a fractional credit in a
            // `bigint` column would be rejected or silently rounded depending
            // on how the driver bound the parameter.
            creditsFree: int(doc, 'credits.free') ?? DEFAULT_FREE_CREDITS,
            creditsFreeLimit: int(doc, 'credits.freeLimit') ?? DEFAULT_FREE_CREDITS,
            creditsDailyRefresh: int(doc, 'credits.dailyRefresh') ?? DEFAULT_DAILY_CREDIT_REFRESH,
            // The compare-and-set column a refresh keys on. The epoch is the
            // honest value for a document that never recorded one: it means
            // "never refreshed", so the next refresh is due rather than
            // deferred 24h by a backfill-time `now()`.
            creditsLastRefresh: date(doc, 'credits.lastRefresh') ?? new Date(0),
            creditsPaid: int(doc, 'credits.paid') ?? 0,
            stripeCustomerId: str(doc, 'stripeCustomerId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },
];
