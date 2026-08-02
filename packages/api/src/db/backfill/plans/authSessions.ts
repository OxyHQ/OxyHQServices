/**
 * Backfill plans for authentication, sessions and device state.
 *
 * ## Where the Mongo baggage is dropped rather than carried
 *
 * - `auth_challenges.purpose` was optional in Mongo, so every reader carried
 *   `{ $in: ['signin', null] }` for documents predating the field. Here it is
 *   `NOT NULL DEFAULT 'signin'` and the backfill maps null ONCE, which is the
 *   whole reason the legacy branch does not travel.
 * - `DeviceSession.secretHash` and `AuthSession.authorizeCode` used Mongoose's
 *   `default: undefined` workaround, because Mongo's sparse unique index
 *   collides on nulls. Postgres treats NULLs as DISTINCT, so a plain nullable
 *   unique column is already correct — and per `CONVENTIONS.md` the value must
 *   NEVER become `''`, which is a real value and would collide for real. `str()`
 *   preserves the distinction: absent is `null`, and an empty string stays an
 *   empty string rather than being silently promoted.
 * - `Session.deviceInfo.*` was an embedded object; every field is a real column.
 *
 * ## The one collection here whose rows outlive their own deadline
 *
 * `sessions` and `auth_challenges` both had Mongo TTL indexes, replaced by the
 * expiry sweep in `db/expiry.ts`. The backfill copies expired-but-not-yet-swept
 * rows exactly as it finds them: deciding what is expired is the sweep's job
 * and the read-side filters', not a migration's, and dropping them here would
 * make the row count differ from Mongo's for a reason no verifier could
 * distinguish from a bug.
 */

import {
  authChallenges,
  authCodes,
  authSessions,
  civicNonces,
  devicePairingSessions,
  deviceSessionAccounts,
  deviceSessions,
  domainVerifications,
  identityBackups,
  pushTokens,
  sessions,
  webauthnChallenges,
  webauthnCredentials,
} from '../../schema';
import type { CollectionPlan } from '../plan';
import { buildRow } from '../rowBuilder';
import {
  bool,
  date,
  id,
  int,
  jsonObject,
  ownId,
  reqBytes,
  reqDate,
  reqId,
  reqInt,
  reqStr,
  str,
  strArray,
  subdocuments,
} from '../values';

export const AUTH_SESSION_PLANS: readonly CollectionPlan[] = [
  // -------------------------------------------------------------------------
  // sessions
  // -------------------------------------------------------------------------
  {
    collection: 'sessions',
    table: sessions,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        sessions,
        buildRow(
          sessions,
          {
            id: documentId,
            sessionId: reqStr(doc, 'sessionId'),
            userId: reqId(doc, 'userId'),
            deviceId: reqStr(doc, 'deviceId'),
            // `deviceInfo` was an embedded object; six real columns now.
            deviceName: str(doc, 'deviceInfo.deviceName'),
            deviceType: reqStr(doc, 'deviceInfo.deviceType'),
            platform: reqStr(doc, 'deviceInfo.platform'),
            browser: str(doc, 'deviceInfo.browser'),
            os: str(doc, 'deviceInfo.os'),
            lastActiveAt: date(doc, 'deviceInfo.lastActive') ?? new Date(0),
            userAgent: str(doc, 'deviceInfo.userAgent'),
            deviceFingerprint: str(doc, 'deviceInfo.fingerprint'),
            // `deviceInfo.ipAddress` and `deviceInfo.location` were REMOVED under
            // the no-user-IPs-at-rest invariant. There is no column, so a stale
            // production document carrying either simply does not travel.
            accessToken: reqStr(doc, 'accessToken'),
            refreshToken: reqStr(doc, 'refreshToken'),
            previousRefreshToken: str(doc, 'previousRefreshToken'),
            tokenRotatedAt: date(doc, 'tokenRotatedAt'),
            operatedByUserId: id(doc, 'operatedByUserId'),
            isActive: bool(doc, 'isActive') ?? true,
            expiresAt: reqDate(doc, 'expiresAt'),
            lastRefresh: date(doc, 'lastRefresh') ?? new Date(0),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // device sessions — the server authority, plus its account set
  // -------------------------------------------------------------------------
  {
    collection: 'devicesessions',
    table: deviceSessions,
    childTables: [deviceSessionAccounts],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        deviceSessions,
        buildRow(
          deviceSessions,
          {
            id: documentId,
            deviceId: reqStr(doc, 'deviceId'),
            activeAccountId: id(doc, 'activeAccountId'),
            // Nullable UNIQUE. Postgres treats NULLs as DISTINCT, so the
            // `default: undefined` sparse-index workaround has no counterpart —
            // and must never become `''`.
            secretHash: str(doc, 'secretHash'),
            prevSecretHash: str(doc, 'prevSecretHash'),
            prevSecretExpiresAt: date(doc, 'prevSecretExpiresAt'),
            backgroundSecretHash: str(doc, 'backgroundSecretHash'),
            backgroundSecretAccountId: id(doc, 'backgroundSecretAccountId'),
            backgroundSecretExpiresAt: date(doc, 'backgroundSecretExpiresAt'),
            revision: int(doc, 'revision') ?? 0,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // Each entry carries TWO user references, which is why it is a table and
      // not `jsonb`: inside a jsonb value neither could carry an `ON DELETE`.
      // `addedAt` IS the row's birth instant — `addAccount` replaces an entry
      // wholesale — so there is deliberately no separate `created_at`.
      for (const [account] of subdocuments(doc, 'accounts')) {
        emit(
          deviceSessionAccounts,
          buildRow(
            deviceSessionAccounts,
            {
              deviceSessionId: documentId,
              accountId: reqId(account, 'accountId'),
              sessionId: reqStr(account, 'sessionId'),
              authuser: reqInt(account, 'authuser'),
              addedAt: date(account, 'addedAt') ?? new Date(0),
              operatedByUserId: id(account, 'operatedByUserId'),
            },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // challenges and codes
  // -------------------------------------------------------------------------
  {
    collection: 'authchallenges',
    table: authChallenges,
    enumAudits: [{ path: 'purpose', column: authChallenges.purpose, absentAs: 'signin' }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        authChallenges,
        buildRow(
          authChallenges,
          {
            id: documentId,
            publicKey: reqStr(doc, 'publicKey'),
            challenge: reqStr(doc, 'challenge'),
            // The one place the legacy null is mapped. Readers now compare with
            // plain equality.
            purpose: str(doc, 'purpose') ?? 'signin',
            expiresAt: reqDate(doc, 'expiresAt'),
            used: bool(doc, 'used') ?? false,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'authcodes',
    table: authCodes,
    enumAudits: [{ path: 'codeChallengeMethod', column: authCodes.codeChallengeMethod }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        authCodes,
        buildRow(
          authCodes,
          {
            id: documentId,
            codeHash: reqStr(doc, 'codeHash'),
            userId: reqId(doc, 'userId'),
            operatedByUserId: id(doc, 'operatedByUserId'),
            // Mongo called it `appId` and stored the applicationId; the column
            // says what it is.
            applicationId: reqId(doc, 'appId'),
            redirectUri: reqStr(doc, 'redirectUri'),
            codeChallenge: str(doc, 'codeChallenge'),
            codeChallengeMethod: str(doc, 'codeChallengeMethod'),
            scopes: strArray(doc, 'scopes') ?? [],
            deviceId: str(doc, 'deviceId'),
            usedAt: date(doc, 'usedAt'),
            expiresAt: reqDate(doc, 'expiresAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // auth sessions — the Commons approval request, with its OAuth binding
  // -------------------------------------------------------------------------
  {
    collection: 'authsessions',
    table: authSessions,
    enumAudits: [
      { path: 'status', column: authSessions.status, absentAs: 'pending' },
      { path: 'purpose', column: authSessions.purpose, absentAs: 'device_sign_in' },
      { path: 'deniedReason', column: authSessions.deniedReason },
      {
        path: 'oauth.codeChallengeMethod',
        column: authSessions.oauthCodeChallengeMethod,
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);

      // `oauth` is present-or-absent as a whole, and
      // `auth_sessions_oauth_binding_check` enforces exactly that: the three
      // required parts travel together or not at all. Reading the embedded
      // object rather than each leaf is what keeps the half state
      // unrepresentable.
      const oauth = jsonObject(doc, 'oauth');
      const oauthColumns =
        oauth === null
          ? {
              oauthRedirectUri: null,
              oauthCodeChallenge: null,
              oauthCodeChallengeMethod: null,
              oauthScopes: null,
              oauthSubjectAccountId: null,
            }
          : {
              oauthRedirectUri: reqStr(oauth, 'redirectUri'),
              oauthCodeChallenge: reqStr(oauth, 'codeChallenge'),
              oauthCodeChallengeMethod: reqStr(oauth, 'codeChallengeMethod'),
              oauthScopes: strArray(oauth, 'scopes') ?? [],
              oauthSubjectAccountId: id(oauth, 'subjectAccountId'),
            };

      emit(
        authSessions,
        buildRow(
          authSessions,
          {
            id: documentId,
            sessionToken: reqStr(doc, 'sessionToken'),
            // Nullable UNIQUE — same `default: undefined` note as `secretHash`.
            authorizeCode: str(doc, 'authorizeCode'),
            boundOrigin: str(doc, 'boundOrigin'),
            originVerified: bool(doc, 'originVerified') ?? false,
            requesterLabel: str(doc, 'requesterLabel'),
            challengeNonce: str(doc, 'challengeNonce'),
            applicationId: reqId(doc, 'applicationId'),
            deviceId: str(doc, 'deviceId'),
            status: str(doc, 'status') ?? 'pending',
            purpose: str(doc, 'purpose') ?? 'device_sign_in',
            ...oauthColumns,
            finalizedAuthCodeId: id(doc, 'finalizedAuthCodeId'),
            deniedReason: str(doc, 'deniedReason'),
            authorizedBy: str(doc, 'authorizedBy'),
            authorizedUserId: id(doc, 'authorizedUserId'),
            authorizedSessionId: str(doc, 'authorizedSessionId'),
            // Progress is timestamps, never statuses — both ride beside the
            // state machine rather than inside it.
            pushSentAt: date(doc, 'pushSentAt'),
            openedAt: date(doc, 'openedAt'),
            consumedAt: date(doc, 'consumedAt'),
            expiresAt: reqDate(doc, 'expiresAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // device pairing
  // -------------------------------------------------------------------------
  {
    collection: 'devicepairingsessions',
    table: devicePairingSessions,
    enumAudits: [{ path: 'status', column: devicePairingSessions.status, absentAs: 'pending' }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        devicePairingSessions,
        buildRow(
          devicePairingSessions,
          {
            id: documentId,
            pairingId: reqStr(doc, 'pairingId'),
            newDeviceEphemeralPublicKey: reqStr(doc, 'newDeviceEphemeralPublicKey'),
            newDeviceLabel: str(doc, 'newDeviceLabel'),
            oldDeviceEphemeralPublicKey: str(doc, 'oldDeviceEphemeralPublicKey'),
            ciphertext: str(doc, 'ciphertext'),
            nonce: str(doc, 'nonce'),
            status: str(doc, 'status') ?? 'pending',
            approvedByUserId: id(doc, 'approvedByUserId'),
            expiresAt: reqDate(doc, 'expiresAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // webauthn
  // -------------------------------------------------------------------------
  {
    collection: 'webauthnchallenges',
    table: webauthnChallenges,
    enumAudits: [{ path: 'type', column: webauthnChallenges.type }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        webauthnChallenges,
        buildRow(
          webauthnChallenges,
          {
            id: documentId,
            challenge: reqStr(doc, 'challenge'),
            type: reqStr(doc, 'type'),
            // Nullable: a registration challenge exists before the account does.
            userId: id(doc, 'userId'),
            expiresAt: reqDate(doc, 'expiresAt'),
            used: bool(doc, 'used') ?? false,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'webauthncredentials',
    table: webauthnCredentials,
    enumAudits: [{ path: 'deviceType', column: webauthnCredentials.deviceType }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        webauthnCredentials,
        buildRow(
          webauthnCredentials,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            credentialID: reqStr(doc, 'credentialID'),
            // The only `bytea` in the schema, and it is load-bearing: a mangled
            // public key is an account that can no longer sign in, with no error
            // until the user tries.
            credentialPublicKey: reqBytes(doc, 'credentialPublicKey'),
            counter: int(doc, 'counter') ?? 0,
            transports: strArray(doc, 'transports'),
            deviceType: reqStr(doc, 'deviceType'),
            backedUp: bool(doc, 'backedUp') ?? false,
            userVerified: bool(doc, 'userVerified') ?? false,
            name: reqStr(doc, 'name'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            lastUsedAt: date(doc, 'lastUsedAt'),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // identity backup
  // -------------------------------------------------------------------------
  {
    collection: 'identitybackups',
    table: identityBackups,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        identityBackups,
        buildRow(
          identityBackups,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            lookupIdHash: reqStr(doc, 'lookupIdHash'),
            publicKeyHint: reqStr(doc, 'publicKeyHint'),
            ciphertext: reqStr(doc, 'ciphertext'),
            nonce: reqStr(doc, 'nonce'),
            algorithm: reqStr(doc, 'algorithm'),
            kdfInfo: reqStr(doc, 'kdfInfo'),
            version: reqInt(doc, 'version'),
            // Mongo declared `createdAt` as a STRING here — the client's own
            // ISO-8601 snapshot timestamp, part of the encrypted envelope's
            // provenance. It is kept verbatim as text rather than parsed into a
            // timestamptz, because re-rendering it would change the bytes the
            // client compares against.
            clientCreatedAt: reqStr(doc, 'createdAt'),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // domain verification tokens and civic nonces
  // -------------------------------------------------------------------------
  {
    collection: 'domainverifications',
    table: domainVerifications,
    uniquenessAudits: [
      {
        index: 'domain_verifications_user_id_lower_domain_key',
        key: [
          { path: 'userId', normalize: 'exact' },
          { path: 'domain', normalize: 'lower' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        domainVerifications,
        buildRow(
          domainVerifications,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            domain: reqStr(doc, 'domain'),
            token: reqStr(doc, 'token'),
            expiresAt: reqDate(doc, 'expiresAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
      // Mongo's `status` (`enum: ['pending']`) and `method` do not travel: a
      // one-valued enum carries no information, and the row is deleted once the
      // domain is verified — `user_verified_domains` is where a verified domain
      // lives, with its own `method`.
    },
  },

  {
    collection: 'civicnonces',
    table: civicNonces,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        civicNonces,
        buildRow(
          civicNonces,
          {
            id: documentId,
            nonceHash: reqStr(doc, 'nonceHash'),
            purpose: reqStr(doc, 'purpose'),
            subjectUserId: id(doc, 'subjectUserId'),
            expiresAt: reqDate(doc, 'expiresAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // push tokens
  // -------------------------------------------------------------------------
  {
    collection: 'pushtokens',
    table: pushTokens,
    enumAudits: [{ path: 'platform', column: pushTokens.platform }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        pushTokens,
        buildRow(
          pushTokens,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            // Mongoose trimmed this as a schema SETTER, which has no Postgres
            // counterpart (`CONVENTIONS.md`, "Mongoose behaviour that has no
            // schema counterpart"). Re-applied here so an untrimmed legacy row
            // cannot collide with its own trimmed self under
            // `push_tokens_user_id_token_key`.
            token: reqStr(doc, 'token').trim(),
            platform: reqStr(doc, 'platform'),
            deviceId: str(doc, 'deviceId'),
            // NULL means "not scoped to any application" — which is why the FK
            // is CASCADE rather than SET NULL.
            applicationId: id(doc, 'applicationId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },
];
