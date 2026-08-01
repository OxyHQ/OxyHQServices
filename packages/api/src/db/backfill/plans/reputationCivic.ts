/**
 * Backfill plans for reputation, moderation and the civic identity layer.
 *
 * Twenty-two collections, and the group where the Mongo→Postgres shape change is
 * largest: nine embedded subdocuments flatten into columns on ONE table, six
 * subdocument arrays become child tables, and four `Map`s become `jsonb` or a
 * child table depending on what the key space is.
 *
 * ## Where a Mongo field NAME differs from its column
 *
 * Every one of these is a deliberate schema decision, recorded in the schema
 * file's own doc comment. They are listed together here because a rename is the
 * one mistake `buildRow` can only catch on the DESTINATION side — a wrong SOURCE
 * path reads as `null` and travels silently.
 *
 * | Mongo | Column | Why |
 * |---|---|---|
 * | `SecurityActivity.timestamp` | `occurred_at` | It is the EVENT time, not the row's; and `timestamp` is a SQL type name, which `pg_get_indexdef` quotes and the expiry gate's index check then fails to match. |
 * | `ModerationEffect.policyVersions.{universal,application,oxyConduct}` | `policy_version_{universal,application,oxy_conduct}` | A known-shape subdocument becomes real columns; the third is a real foreign key. |
 * | `ReputationBalance.reviewing.globalReliability` | `reviewing_global_reliability` | Block name as a prefix, like the other eight subdocuments. |
 * | `ReputationBalance.contextualInfluence.*` | `contextual_*` | Same, shortened — the block is named `contextualInfluence` and the columns are not weights of a vote. |
 * | `ValidationRequest.selectedValidatorIds[]` | `validation_request_validators` rows | An id array with a multikey index is a junction table wearing an array's clothes. |
 * | `SignedRecord.envelope.collection` | `signed_records.nsid` | `collection` is a reserved Mongoose `Document` member; the denormalized column kept the AtProto name. |
 *
 * ## Two number columns that are epoch milliseconds in Mongo
 *
 * `NodeIngestWitness.ingestedAt` and `TransparencyCheckpoint.periodEnd` (plus
 * each anchor's `anchoredAt`) are `Number` in Mongoose and `timestamptz` here.
 * `date()` accepts epoch ms, and a whole-millisecond value round-trips through
 * `timestamptz`'s microsecond resolution exactly — which is what lets the call
 * site rebuild the identical signing input with `.getTime()`, since both values
 * are part of signed bytes.
 *
 * ## What deliberately does NOT travel
 *
 * `SecurityActivity.ipAddress` was REMOVED under the platform-wide
 * no-user-IPs-at-rest invariant. There is no column, and this file never reads
 * the field, so a stale production document still carrying one leaves it behind.
 *
 * ## Ids are copied verbatim, including the ones that are not ObjectIds
 *
 * `record_id` is a content address (sha256 of a canonical signing input), and
 * five tables reference `signed_records.record_id` as a real foreign key. It is
 * still read with `reqId`/`id` rather than `reqStr`, for one reason: those treat
 * an EMPTY STRING as absent. `personhood.service.ts` and `validator.service.ts`
 * both write `stored.record.recordId ?? ''`, which Mongo accepted as a silently
 * dangling reference — here it becomes a `NOT NULL` failure naming the column
 * and the source `_id`, instead of a foreign-key violation naming a constraint.
 */

import {
  applicationModerationTrust,
  conductStrikes,
  identityBindings,
  moderationEffects,
  moderationPolicies,
  moderationPolicySeverityRules,
  moderationPolicyStandingThresholds,
  nodeIngestWitnesses,
  personhoodStatuses,
  personhoodVouches,
  repoHeads,
  reporterReputationProfiles,
  reputationBalances,
  reputationDisputes,
  reputationReviewingReliability,
  reputationRules,
  reputationTransactions,
  reviewerReputationProfiles,
  securityActivities,
  signedRecords,
  transparencyCheckpointAnchors,
  transparencyCheckpointSignatures,
  transparencyCheckpointSnapshotEntries,
  transparencyCheckpoints,
  validationRequestValidators,
  validationRequests,
  validationVotes,
  validatorAffinities,
  verifiableCredentials,
} from '../../schema';
import type { CollectionPlan } from '../plan';
import { buildRow } from '../rowBuilder';
import {
  bool,
  date,
  id,
  int,
  jsonArray,
  jsonObject,
  num,
  numArray,
  numberMap,
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

export const REPUTATION_CIVIC_PLANS: readonly CollectionPlan[] = [
  // -------------------------------------------------------------------------
  // reputation balances — nine subdocuments flattened, two Maps split off
  // -------------------------------------------------------------------------
  {
    collection: 'reputationbalances',
    table: reputationBalances,
    childTables: [reputationReviewingReliability],
    enumAudits: [
      { path: 'trustTier', column: reputationBalances.trustTier, absentAs: 'new' },
      {
        path: 'personhood.status',
        column: reputationBalances.personhoodStatus,
        absentAs: 'unknown',
      },
      {
        path: 'contribution.tier',
        column: reputationBalances.contributionTier,
        absentAs: 'new',
      },
      {
        path: 'conduct.standing',
        column: reputationBalances.conductStanding,
        absentAs: 'good',
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        reputationBalances,
        buildRow(
          reputationBalances,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),

            // V1: the single-score model. Every default below is the one the
            // Mongoose subdocument's `default: () => ({})` expanded to, written
            // explicitly so the mapping is reviewable rather than implied.
            total: int(doc, 'total') ?? 0,
            positive: int(doc, 'positive') ?? 0,
            negative: int(doc, 'negative') ?? 0,
            breakdownContent: int(doc, 'breakdown.content') ?? 0,
            breakdownSocial: int(doc, 'breakdown.social') ?? 0,
            breakdownTrust: int(doc, 'breakdown.trust') ?? 0,
            breakdownModeration: int(doc, 'breakdown.moderation') ?? 0,
            breakdownPhysical: int(doc, 'breakdown.physical') ?? 0,
            breakdownPenalties: int(doc, 'breakdown.penalties') ?? 0,
            trustTier: str(doc, 'trustTier') ?? 'new',
            influenceDefaultWeight: num(doc, 'influence.defaultWeight') ?? 0,
            influenceReportWeight: num(doc, 'influence.reportWeight') ?? 0,
            influenceModerationWeight: num(doc, 'influence.moderationWeight') ?? 0,
            influenceRankingFeedbackWeight: num(doc, 'influence.rankingFeedbackWeight') ?? 0,
            reliabilityAccurateReports: int(doc, 'reliability.accurateReports') ?? 0,
            reliabilityRejectedReports: int(doc, 'reliability.rejectedReports') ?? 0,
            reliabilityReportAccuracyScore: num(doc, 'reliability.reportAccuracyScore') ?? 0,
            reliabilityAbuseScore: num(doc, 'reliability.abuseScore') ?? 0,

            // V2: personhood, contribution, conduct, reporting, reviewing and
            // contextual influence. `reporting.reliability` and
            // `reviewing.globalReliability` default to the NEUTRAL 0.5, not 0 —
            // "no history" and "a terrible record" are different states.
            personhoodStatus: str(doc, 'personhood.status') ?? 'unknown',
            personhoodScore: num(doc, 'personhood.score') ?? 0,
            contributionPoints: int(doc, 'contribution.points') ?? 0,
            contributionTier: str(doc, 'contribution.tier') ?? 'new',
            conductStanding: str(doc, 'conduct.standing') ?? 'good',
            conductActiveRisk: num(doc, 'conduct.activeRisk') ?? 0,
            conductActiveStrikes: int(doc, 'conduct.activeStrikes') ?? 0,
            conductNextExpiryAt: date(doc, 'conduct.nextExpiryAt'),
            reportingReliability: num(doc, 'reporting.reliability') ?? 0.5,
            reportingConfidence: num(doc, 'reporting.confidence') ?? 0,
            reportingConfirmed: int(doc, 'reporting.confirmed') ?? 0,
            reportingRejected: int(doc, 'reporting.rejected') ?? 0,
            reportingMalicious: int(doc, 'reporting.malicious') ?? 0,
            reviewingGlobalReliability: num(doc, 'reviewing.globalReliability') ?? 0.5,
            contextualReportPriorityWeight:
              num(doc, 'contextualInfluence.reportPriorityWeight') ?? 0,
            contextualReviewSelectionWeight:
              num(doc, 'contextualInfluence.reviewSelectionWeight') ?? 0,
            contextualRankingWeight: num(doc, 'contextualInfluence.rankingWeight') ?? 0,

            lastTransactionId: id(doc, 'lastTransactionId'),
            // The epoch sentinel is the conservative direction for a CACHE
            // marker: it makes an unstamped snapshot read as maximally stale, so
            // the next recompute is prompted rather than the row being trusted.
            recalculatedAt: date(doc, 'recalculatedAt') ?? new Date(0),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // `reviewing.categoryReliability` and `reviewing.languageReliability` are
      // `Map<string, number>` over OPEN key spaces (moderation category ids,
      // BCP-47 tags), which is a key→value RELATION rather than shape-less data
      // — one child table with a `scope` discriminator, composite-keyed on
      // (balance, scope, key) so a map cannot hold one key twice.
      for (const [key, reliability] of Object.entries(
        numberMap(doc, 'reviewing.categoryReliability') ?? {}
      )) {
        emit(
          reputationReviewingReliability,
          buildRow(
            reputationReviewingReliability,
            { balanceId: documentId, scope: 'category', key, reliability },
            documentId
          )
        );
      }
      for (const [key, reliability] of Object.entries(
        numberMap(doc, 'reviewing.languageReliability') ?? {}
      )) {
        emit(
          reputationReviewingReliability,
          buildRow(
            reputationReviewingReliability,
            { balanceId: documentId, scope: 'language', key, reliability },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // the ledger, its rules and its disputes
  // -------------------------------------------------------------------------
  {
    collection: 'reputationtransactions',
    table: reputationTransactions,
    enumAudits: [
      { path: 'category', column: reputationTransactions.category },
      { path: 'status', column: reputationTransactions.status, absentAs: 'active' },
      // Nullable, with no substituted default: an absent field stays NULL, which
      // the column's CHECK explicitly permits.
      { path: 'targetEntityType', column: reputationTransactions.targetEntityType },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        reputationTransactions,
        buildRow(
          reputationTransactions,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            // `integer`, not `double precision`: every authority that produces a
            // figure here produces an integer, so a fractional value is a bug in
            // that authority and `reqInt` surfaces it instead of preserving it.
            points: reqInt(doc, 'points'),
            actionType: reqStr(doc, 'actionType'),
            category: reqStr(doc, 'category'),
            applicationId: id(doc, 'applicationId'),
            credentialId: id(doc, 'credentialId'),
            sourceActionId: str(doc, 'sourceActionId'),
            sourceActionType: str(doc, 'sourceActionType'),
            targetEntityId: str(doc, 'targetEntityId'),
            targetEntityType: str(doc, 'targetEntityType'),
            status: str(doc, 'status') ?? 'active',
            // Self-referencing: the runner defers it to a second UPDATE pass.
            reversedTransactionId: id(doc, 'reversedTransactionId'),
            reason: str(doc, 'reason'),
            metadata: jsonObject(doc, 'metadata'),
            createdByUserId: id(doc, 'createdByUserId'),
            reviewedByUserId: id(doc, 'reviewedByUserId'),
            reviewedAt: date(doc, 'reviewedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'reputationrules',
    table: reputationRules,
    enumAudits: [{ path: 'category', column: reputationRules.category }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        reputationRules,
        buildRow(
          reputationRules,
          {
            id: documentId,
            actionType: reqStr(doc, 'actionType'),
            points: reqInt(doc, 'points'),
            category: reqStr(doc, 'category'),
            description: reqStr(doc, 'description'),
            cooldownInMinutes: int(doc, 'cooldownInMinutes') ?? 0,
            isEnabled: bool(doc, 'isEnabled') ?? true,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'reputationdisputes',
    table: reputationDisputes,
    enumAudits: [{ path: 'status', column: reputationDisputes.status, absentAs: 'open' }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        reputationDisputes,
        buildRow(
          reputationDisputes,
          {
            id: documentId,
            transactionId: reqId(doc, 'transactionId'),
            userId: reqId(doc, 'userId'),
            reason: reqStr(doc, 'reason'),
            status: str(doc, 'status') ?? 'open',
            // Mongoose's `default: undefined` means ABSENT, and the column is
            // nullable with no default to match — `'{}'` would be a different
            // value (an empty list the user supplied) and readers distinguish
            // the two.
            evidence: strArray(doc, 'evidence'),
            resolvedAt: date(doc, 'resolvedAt'),
            resolvedByUserId: id(doc, 'resolvedByUserId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // reporter and reviewer track records — four `Map`s that stay `jsonb`
  // -------------------------------------------------------------------------
  {
    collection: 'reporterreputationprofiles',
    table: reporterReputationProfiles,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        reporterReputationProfiles,
        buildRow(
          reporterReputationProfiles,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            confirmed: int(doc, 'confirmed') ?? 0,
            rejected: int(doc, 'rejected') ?? 0,
            duplicate: int(doc, 'duplicate') ?? 0,
            malicious: int(doc, 'malicious') ?? 0,
            // Associative arrays over an open key space with scalar values, read
            // whole and never joined on — the one case `CONVENTIONS.md` allows
            // `jsonb` for. `numberMap` also checks every value is finite, which
            // the column's `jsonb_typeof(...) = 'object'` CHECK cannot.
            confirmedByFamily: numberMap(doc, 'confirmedByFamily') ?? {},
            rejectedByFamily: numberMap(doc, 'rejectedByFamily') ?? {},
            reliability: num(doc, 'reliability') ?? 0.5,
            confidence: num(doc, 'confidence') ?? 0,
            lastOutcomeAt: date(doc, 'lastOutcomeAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'reviewerreputationprofiles',
    table: reviewerReputationProfiles,
    enumAudits: [
      { path: 'status', column: reviewerReputationProfiles.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        reviewerReputationProfiles,
        buildRow(
          reviewerReputationProfiles,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            status: str(doc, 'status') ?? 'active',
            agreements: int(doc, 'agreements') ?? 0,
            disagreements: int(doc, 'disagreements') ?? 0,
            goldPassed: int(doc, 'goldPassed') ?? 0,
            goldFailed: int(doc, 'goldFailed') ?? 0,
            overturned: int(doc, 'overturned') ?? 0,
            globalReliability: num(doc, 'globalReliability') ?? 0.5,
            categoryReliability: numberMap(doc, 'categoryReliability') ?? {},
            languageReliability: numberMap(doc, 'languageReliability') ?? {},
            unlockedCategories: strArray(doc, 'unlockedCategories') ?? [],
            languages: strArray(doc, 'languages') ?? [],
            seedWeight: num(doc, 'seedWeight') ?? 0,
            suspendedAt: date(doc, 'suspendedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // conduct strikes and moderation effects — the consequence pair
  // -------------------------------------------------------------------------
  {
    collection: 'conductstrikes',
    table: conductStrikes,
    enumAudits: [
      { path: 'effectType', column: conductStrikes.effectType },
      { path: 'severity', column: conductStrikes.severity },
      { path: 'status', column: conductStrikes.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        conductStrikes,
        buildRow(
          conductStrikes,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            incidentId: reqStr(doc, 'incidentId'),
            decisionId: reqStr(doc, 'decisionId'),
            decisionRevision: reqInt(doc, 'decisionRevision'),
            applicationId: id(doc, 'applicationId'),
            effectType: reqStr(doc, 'effectType'),
            severity: reqStr(doc, 'severity'),
            riskPoints: reqNum(doc, 'riskPoints'),
            family: reqStr(doc, 'family'),
            status: str(doc, 'status') ?? 'active',
            // NOT a TTL column: a due strike is RESOLVED (`status` moves to
            // `expired`) and the row survives as the audit trail.
            expiresAt: date(doc, 'expiresAt'),
            // A foreign key now, onto `moderation_policies.policy_version` — in
            // Mongo it was an unchecked string that could name a version with no
            // document at all.
            policyVersion: reqStr(doc, 'policyVersion'),
            transactionId: reqId(doc, 'transactionId'),
            resolvedAt: date(doc, 'resolvedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'moderationeffects',
    table: moderationEffects,
    enumAudits: [
      { path: 'effectType', column: moderationEffects.effectType },
      { path: 'status', column: moderationEffects.status, absentAs: 'applied' },
      { path: 'severity', column: moderationEffects.severity },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        moderationEffects,
        buildRow(
          moderationEffects,
          {
            id: documentId,
            eventId: reqStr(doc, 'eventId'),
            incidentId: reqStr(doc, 'incidentId'),
            caseId: reqStr(doc, 'caseId'),
            decisionId: reqStr(doc, 'decisionId'),
            decisionRevision: reqInt(doc, 'decisionRevision'),
            principalId: reqId(doc, 'principalId'),
            bindingId: reqId(doc, 'bindingId'),
            applicationId: reqId(doc, 'applicationId'),
            credentialId: id(doc, 'credentialId'),
            effectType: reqStr(doc, 'effectType'),
            status: str(doc, 'status') ?? 'applied',
            // `double precision`, unlike the ledger's `integer` `points`: this
            // figure is already multiplied and capped, so it is genuinely
            // fractional.
            points: reqNum(doc, 'points'),
            activeRisk: reqNum(doc, 'activeRisk'),
            severity: reqStr(doc, 'severity'),
            family: reqStr(doc, 'family'),
            repetitionMultiplier: reqNum(doc, 'repetitionMultiplier'),
            multiFindingMultiplier: reqNum(doc, 'multiFindingMultiplier'),
            idempotencyKey: reqStr(doc, 'idempotencyKey'),
            transactionId: reqId(doc, 'transactionId'),
            // NULL MEANS "this effect created no strike", so the FK is CASCADE
            // rather than SET NULL — nothing here rewrites that claim.
            strikeId: id(doc, 'strikeId'),
            reversalTransactionId: id(doc, 'reversalTransactionId'),
            // The `policyVersions` subdocument becomes three columns; the third
            // is a foreign key onto `moderation_policies.policy_version`, the
            // other two are the EMITTING system's identifiers and stay text.
            policyVersionUniversal: reqStr(doc, 'policyVersions.universal'),
            policyVersionApplication: reqStr(doc, 'policyVersions.application'),
            policyVersionOxyConduct: reqStr(doc, 'policyVersions.oxyConduct'),
            proofHash: reqStr(doc, 'proofHash'),
            appliedAt: reqDate(doc, 'appliedAt'),
            reversedAt: date(doc, 'reversedAt'),
            reversalReason: str(doc, 'reversalReason'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // the conduct policy — two subdocument arrays become child tables
  // -------------------------------------------------------------------------
  {
    collection: 'moderationpolicies',
    table: moderationPolicies,
    childTables: [moderationPolicySeverityRules, moderationPolicyStandingThresholds],
    enumAudits: [
      { path: 'status', column: moderationPolicies.status, absentAs: 'active' },
      // Both paths traverse an ARRAY, which is exactly what Mongo's `distinct()`
      // does natively — one entry per severity / per standing.
      {
        path: 'severityRules.severity',
        column: moderationPolicySeverityRules.severity,
      },
      {
        path: 'standingThresholds.standing',
        column: moderationPolicyStandingThresholds.standing,
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        moderationPolicies,
        buildRow(
          moderationPolicies,
          {
            id: documentId,
            policyVersion: reqStr(doc, 'policyVersion'),
            status: str(doc, 'status') ?? 'active',
            // Two SCALAR arrays that stay native arrays: `conduct_families` is a
            // set read as a whole, and `repetition_multipliers` is
            // position-significant (index = ordinal of the repeat), which a
            // child table would only re-encode.
            conductFamilies: strArray(doc, 'conductFamilies'),
            repetitionMultipliers: numArray(doc, 'repetitionMultipliers'),
            repetitionWindowDays: reqInt(doc, 'repetitionWindowDays'),
            multiFindingSecondaryShare: reqNum(doc, 'multiFindingSecondaryShare'),
            multiFindingCap: reqNum(doc, 'multiFindingCap'),
            provisionalEffectsAllowed: bool(doc, 'provisionalEffectsAllowed') ?? false,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // `_id: false` on both subschemas, so these rows have no id of their own
      // to preserve and the generated v7 is correct — nothing ever referenced
      // one. The ARRAY POSITION is not carried either: `(policy_id, severity)`
      // and `(policy_id, standing)` are the real keys, and the "highest first"
      // ordering of `standingThresholds` is derivable from `min_risk` itself.
      for (const [rule] of subdocuments(doc, 'severityRules')) {
        emit(
          moderationPolicySeverityRules,
          buildRow(
            moderationPolicySeverityRules,
            {
              policyId: documentId,
              severity: reqStr(rule, 'severity'),
              points: reqNum(rule, 'points'),
              riskPoints: reqNum(rule, 'riskPoints'),
              // NULL is MEANINGFUL here — "the risk does not lapse
              // automatically and requires a specialised recovery review" — and
              // is not the same as unset. Mongoose spelled it `default: null`.
              riskExpiryDays: int(rule, 'riskExpiryDays'),
            },
            documentId
          )
        );
      }

      for (const [threshold] of subdocuments(doc, 'standingThresholds')) {
        emit(
          moderationPolicyStandingThresholds,
          buildRow(
            moderationPolicyStandingThresholds,
            {
              policyId: documentId,
              standing: reqStr(threshold, 'standing'),
              minRisk: reqNum(threshold, 'minRisk'),
            },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // application moderation standing (table name is SINGULAR)
  // -------------------------------------------------------------------------
  {
    collection: 'applicationmoderationtrusts',
    table: applicationModerationTrust,
    enumAudits: [
      {
        path: 'standing',
        column: applicationModerationTrust.standing,
        absentAs: 'sandbox',
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        applicationModerationTrust,
        buildRow(
          applicationModerationTrust,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            standing: str(doc, 'standing') ?? 'sandbox',
            evidenceIntegrity: num(doc, 'evidenceIntegrity') ?? 0,
            identityBindingReliability: num(doc, 'identityBindingReliability') ?? 0,
            decisionOverturnRate: num(doc, 'decisionOverturnRate') ?? 0,
            policyQuality: num(doc, 'policyQuality') ?? 0,
            globalReputationEffectsAllowed:
              bool(doc, 'globalReputationEffectsAllowed') ?? false,
            reviewedByUserId: id(doc, 'reviewedByUserId'),
            reviewedAt: date(doc, 'reviewedAt'),
            reviewNote: str(doc, 'reviewNote'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // identity bindings — the proof a moderation effect rests on
  // -------------------------------------------------------------------------
  {
    collection: 'identitybindings',
    table: identityBindings,
    enumAudits: [
      { path: 'bindingType', column: identityBindings.bindingType },
      { path: 'status', column: identityBindings.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        identityBindings,
        buildRow(
          identityBindings,
          {
            id: documentId,
            applicationId: reqId(doc, 'applicationId'),
            userId: reqId(doc, 'userId'),
            localPrincipalId: reqStr(doc, 'localPrincipalId'),
            bindingType: reqStr(doc, 'bindingType'),
            status: str(doc, 'status') ?? 'active',
            verifiedAt: reqDate(doc, 'verifiedAt'),
            credentialId: id(doc, 'credentialId'),
            revokedAt: date(doc, 'revokedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // proof of personhood
  // -------------------------------------------------------------------------
  {
    collection: 'personhoodstatuses',
    table: personhoodStatuses,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        personhoodStatuses,
        buildRow(
          personhoodStatuses,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            score: num(doc, 'score') ?? 0,
            isRealPerson: bool(doc, 'isRealPerson') ?? false,
            vouchCount: int(doc, 'vouchCount') ?? 0,
            realLifeCount: int(doc, 'realLifeCount') ?? 0,
            biometricBound: bool(doc, 'biometricBound') ?? false,
            sybilPenalty: num(doc, 'sybilPenalty') ?? 0,
            // The `breakdown` subdocument has a closed six-field shape, so it is
            // columns with a `breakdown_` prefix. `sybil_penalty` deliberately
            // appears twice — the top-level column is the penalty applied at the
            // last recompute, this one is the audit copy inside the score
            // breakdown, and both are on the wire today.
            breakdownVouchSignal: num(doc, 'breakdown.vouchSignal') ?? 0,
            breakdownRealLifeSignal: num(doc, 'breakdown.realLifeSignal') ?? 0,
            breakdownBiometricSignal: num(doc, 'breakdown.biometricSignal') ?? 0,
            breakdownEvidence: num(doc, 'breakdown.evidence') ?? 0,
            breakdownSybilPenalty: num(doc, 'breakdown.sybilPenalty') ?? 0,
            breakdownSeed: bool(doc, 'breakdown.seed') ?? false,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'personhoodvouches',
    table: personhoodVouches,
    enumAudits: [{ path: 'status', column: personhoodVouches.status, absentAs: 'active' }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        personhoodVouches,
        buildRow(
          personhoodVouches,
          {
            id: documentId,
            voucherUserId: reqId(doc, 'voucherUserId'),
            subjectUserId: reqId(doc, 'subjectUserId'),
            stakeAmount: reqInt(doc, 'stakeAmount'),
            // A real foreign key onto `signed_records.record_id` — the signed
            // record IS the vouch. Read with `reqId` so the `?? ''` written by
            // `personhood.service.ts` fails here, naming the column and the
            // source `_id`, rather than as a bare constraint violation.
            recordId: reqId(doc, 'recordId'),
            status: str(doc, 'status') ?? 'active',
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // the signed-record chain and its head
  // -------------------------------------------------------------------------
  {
    collection: 'signedrecords',
    table: signedRecords,
    enumAudits: [{ path: 'type', column: signedRecords.type }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        signedRecords,
        buildRow(
          signedRecords,
          {
            id: documentId,
            subjectDid: reqStr(doc, 'subjectDid'),
            userId: reqId(doc, 'userId'),
            type: reqStr(doc, 'type'),
            // Stored verbatim. Verification never reads these bytes back — it
            // re-canonicalizes from the PARSED value — so `jsonb`'s key
            // reordering and number re-formatting are representation-only.
            envelope: reqJsonObject(doc, 'envelope'),
            publicKey: reqStr(doc, 'publicKey'),
            verified: bool(doc, 'verified') ?? false,
            // The four v2 chain fields, absent together on every v1 row.
            seq: int(doc, 'seq'),
            // Self-referencing onto `record_id`; the runner defers it to a
            // second UPDATE pass. `null` at genesis.
            prev: id(doc, 'prev'),
            recordId: id(doc, 'recordId'),
            // The envelope's `collection`, denormalized under the AtProto name.
            nsid: str(doc, 'nsid'),
            rkey: str(doc, 'rkey'),
            // Append-only: the ABSENCE of `updated_at` is the contract, so there
            // is deliberately no `updatedAt` key here.
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'repoheads',
    table: repoHeads,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        repoHeads,
        buildRow(
          repoHeads,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            subjectDid: reqStr(doc, 'subjectDid'),
            seq: reqInt(doc, 'seq'),
            headRecordId: reqId(doc, 'headRecordId'),
            recordCount: int(doc, 'recordCount') ?? 0,
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'nodeingestwitnesses',
    table: nodeIngestWitnesses,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        nodeIngestWitnesses,
        buildRow(
          nodeIngestWitnesses,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            recordId: reqId(doc, 'recordId'),
            witnessSignature: reqStr(doc, 'witnessSignature'),
            // `Number` (epoch ms) in Mongo, `timestamptz` here. It is part of the
            // signed input `canonicalize({ recordId, userId, ingestedAt })`, and
            // a whole-millisecond value round-trips exactly, so the call site
            // re-derives the identical bytes with `.getTime()`.
            ingestedAt: reqDate(doc, 'ingestedAt'),
            // Append-only: no `updated_at` column.
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // the validator jury
  // -------------------------------------------------------------------------
  {
    collection: 'validationrequests',
    table: validationRequests,
    childTables: [validationRequestValidators],
    enumAudits: [
      { path: 'status', column: validationRequests.status, absentAs: 'pending' },
      // Nullable: a request carries no outcome until it is tallied.
      { path: 'outcome', column: validationRequests.outcome },
    ],
    uniquenessAudits: [
      {
        // Postgres now enforces what `ValidationRequest.ts` said was "enforced in
        // the service" because Mongo's `partialFilterExpression` cannot express
        // `$in`. This audit OVER-approximates it: the real index is partial on
        // `status in ('pending','quorum_met')` and the audit shape carries no
        // predicate, so a reported pair must be checked against `status` before
        // it counts — two CLOSED requests sharing a `sourceActionId` are legal
        // and will still be reported here.
        index: 'validation_requests_open_source_action_key',
        key: [
          { path: 'sourceActionId', normalize: 'exact' },
        ],
      },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        validationRequests,
        buildRow(
          validationRequests,
          {
            id: documentId,
            subjectUserId: reqId(doc, 'subjectUserId'),
            actionType: reqStr(doc, 'actionType'),
            applicationId: id(doc, 'applicationId'),
            sourceActionId: reqStr(doc, 'sourceActionId'),
            // The arbitrary claim body the jurors inspect, shaped by whichever
            // application opened the request — `jsonb` is the intended use, and
            // `payload_hash` is what the signed verdict binds to.
            payload: reqJsonObject(doc, 'payload'),
            payloadHash: reqStr(doc, 'payloadHash'),
            status: str(doc, 'status') ?? 'pending',
            quorum: reqInt(doc, 'quorum'),
            threshold: reqInt(doc, 'threshold'),
            highValue: bool(doc, 'highValue') ?? false,
            rngSeed: reqStr(doc, 'rngSeed'),
            // Write-once audit evidence of a selection that already happened:
            // never joined, never filtered, and deliberately a FROZEN record of
            // the pool, so foreign keys would let a later deletion rewrite it.
            candidateSnapshot: jsonArray(doc, 'candidateSnapshot') ?? [],
            expiresAt: reqDate(doc, 'expiresAt'),
            outcome: str(doc, 'outcome'),
            resolvedTxnId: id(doc, 'resolvedTxnId'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // `selectedValidatorIds` is an ObjectId array with a multikey index behind
      // the juror-inbox query — a junction table wearing an array's clothes. The
      // draw ORDER is part of what `rng_seed` + `candidate_snapshot` let an
      // auditor reproduce, so the array position travels as `position`.
      const validatorIds = strArray(doc, 'selectedValidatorIds') ?? [];
      for (const [position, userId] of validatorIds.entries()) {
        emit(
          validationRequestValidators,
          buildRow(
            validationRequestValidators,
            { requestId: documentId, userId, position },
            documentId
          )
        );
      }
    },
  },

  {
    collection: 'validationvotes',
    table: validationVotes,
    enumAudits: [{ path: 'verdict', column: validationVotes.verdict }],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        validationVotes,
        buildRow(
          validationVotes,
          {
            id: documentId,
            requestId: reqId(doc, 'requestId'),
            validatorUserId: reqId(doc, 'validatorUserId'),
            verdict: reqStr(doc, 'verdict'),
            // Same measured `jsonb` decision as `signed_records.envelope`.
            envelope: reqJsonObject(doc, 'envelope'),
            publicKey: reqStr(doc, 'publicKey'),
            // The `?? ''` hazard again — see `personhood_vouches.record_id`.
            recordId: reqId(doc, 'recordId'),
            stakeWeight: num(doc, 'stakeWeight') ?? 1,
            // Append-only: no `updated_at` column.
            createdAt: date(doc, 'createdAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  {
    collection: 'validatoraffinities',
    table: validatorAffinities,
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        validatorAffinities,
        buildRow(
          validatorAffinities,
          {
            id: documentId,
            // `validator_affinities_canonical_pair_check` asserts
            // `validator_a < validator_b`. The pair is ALREADY stored canonically
            // by `affinityPair`, so the values travel verbatim: reordering them
            // here would silently merge two rows Mongo kept apart, which is a
            // data repair rather than a copy and belongs to whoever reads the
            // failure the CHECK produces.
            validatorA: reqId(doc, 'validatorA'),
            validatorB: reqId(doc, 'validatorB'),
            coVoteCount: int(doc, 'coVoteCount') ?? 0,
            lastCoVoteAt: reqDate(doc, 'lastCoVoteAt'),
            // `timestamps: false` in Mongoose and no hand-declared `createdAt`,
            // so this table has NEITHER timestamp column. The absence is the
            // port, not an omission.
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // verifiable credentials
  // -------------------------------------------------------------------------
  {
    collection: 'verifiablecredentials',
    table: verifiableCredentials,
    enumAudits: [
      { path: 'status', column: verifiableCredentials.status, absentAs: 'active' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        verifiableCredentials,
        buildRow(
          verifiableCredentials,
          {
            id: documentId,
            holderUserId: reqId(doc, 'holderUserId'),
            holderDid: reqStr(doc, 'holderDid'),
            // Absent for an org-issued credential, where Oxy signed custodially
            // on behalf of an Application — `issuer_did` still records who
            // signed.
            issuerUserId: id(doc, 'issuerUserId'),
            issuerDid: reqStr(doc, 'issuerDid'),
            types: strArray(doc, 'types'),
            claims: jsonObject(doc, 'claims') ?? {},
            recordId: reqId(doc, 'recordId'),
            status: str(doc, 'status') ?? 'active',
            issuedAt: reqDate(doc, 'issuedAt'),
            expiresAt: date(doc, 'expiresAt'),
            revokedAt: date(doc, 'revokedAt'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },

  // -------------------------------------------------------------------------
  // transparency checkpoints — three subdocument arrays, three child tables
  // -------------------------------------------------------------------------
  {
    collection: 'transparencycheckpoints',
    table: transparencyCheckpoints,
    childTables: [
      transparencyCheckpointAnchors,
      transparencyCheckpointSignatures,
      transparencyCheckpointSnapshotEntries,
    ],
    enumAudits: [
      { path: 'signatures.alg', column: transparencyCheckpointSignatures.alg },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        transparencyCheckpoints,
        buildRow(
          transparencyCheckpoints,
          {
            id: documentId,
            // The column keeps the name `index`: drizzle quotes every identifier
            // it emits, and renaming would diverge from the published
            // `TransparencyCheckpoint` contract.
            index: reqInt(doc, 'index'),
            // `Number` (epoch ms) in Mongo and part of the SIGNED body; safe as a
            // `timestamptz` only because a whole-millisecond value round-trips
            // exactly, which is what lets the call site rebuild the identical
            // signing input with `.getTime()`.
            periodEnd: reqDate(doc, 'periodEnd'),
            treeSize: reqInt(doc, 'treeSize'),
            root: reqStr(doc, 'root'),
            // `null` at genesis; Mongoose spelled that `default: null`.
            prevCheckpointHash: str(doc, 'prevCheckpointHash'),
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );

      // The three child rows carry no `created_at`/`updated_at` of their own:
      // the subdocuments held no timestamp, and `created_at` is the ROW's write
      // time, so the column default is literally correct rather than a guess.

      // `signatures` — Oxy signs at insert, witnesses co-sign later, and "Oxy's
      // signature first" is how `buildCheckpoint` writes it and how the DTO
      // reads it, so the array position is a real column.
      for (const [signature, position] of subdocuments(doc, 'signatures')) {
        emit(
          transparencyCheckpointSignatures,
          buildRow(
            transparencyCheckpointSignatures,
            {
              checkpointId: documentId,
              position,
              publicKey: reqStr(signature, 'publicKey'),
              alg: reqStr(signature, 'alg'),
              signature: reqStr(signature, 'signature'),
            },
            documentId
          )
        );
      }

      // `anchors` — appended after broadcast, then UPDATED as confirmations
      // accrue, which is why `(checkpoint, network, txid)` is the key and the
      // array position is NOT carried: it identifies nothing.
      for (const [anchor] of subdocuments(doc, 'anchors')) {
        emit(
          transparencyCheckpointAnchors,
          buildRow(
            transparencyCheckpointAnchors,
            {
              checkpointId: documentId,
              network: reqStr(anchor, 'network'),
              txid: reqStr(anchor, 'txid'),
              confirmations: int(anchor, 'confirmations') ?? 0,
              // `Number` (epoch ms) in Mongo, like `period_end`.
              anchoredAt: reqDate(anchor, 'anchoredAt'),
            },
            documentId
          )
        );
      }

      // `snapshot` — the largest embedded array in the codebase, and its ORDER
      // is load-bearing: `getInclusionProof` uses the array position as the
      // Merkle leaf index, so `leaf_index` is a real column and half the
      // primary key.
      for (const [entry, leafIndex] of subdocuments(doc, 'snapshot')) {
        emit(
          transparencyCheckpointSnapshotEntries,
          buildRow(
            transparencyCheckpointSnapshotEntries,
            {
              checkpointId: documentId,
              leafIndex,
              subjectDid: reqStr(entry, 'subjectDid'),
              seq: reqInt(entry, 'seq'),
              // Deliberately NOT a foreign key: a committed value is frozen
              // evidence, not a live pointer, so it is read as plain text and an
              // unrelated erasure can never alter what a signed checkpoint
              // committed to.
              headRecordId: reqStr(entry, 'headRecordId'),
            },
            documentId
          )
        );
      }
    },
  },

  // -------------------------------------------------------------------------
  // the account's own audit trail
  // -------------------------------------------------------------------------
  {
    collection: 'securityactivities',
    table: securityActivities,
    enumAudits: [
      { path: 'eventType', column: securityActivities.eventType },
      { path: 'severity', column: securityActivities.severity, absentAs: 'low' },
    ],
    transform(doc, emit) {
      const documentId = ownId(doc);
      emit(
        securityActivities,
        buildRow(
          securityActivities,
          {
            id: documentId,
            userId: reqId(doc, 'userId'),
            eventType: reqStr(doc, 'eventType'),
            eventDescription: reqStr(doc, 'eventDescription'),
            // `{}` is a VALUE here ("no detail"), matching Mongoose's
            // `default: {}` — not the absence of one.
            metadata: jsonObject(doc, 'metadata') ?? {},
            // A client string, not a network address.
            userAgent: str(doc, 'userAgent'),
            deviceId: str(doc, 'deviceId'),
            // Mongo's `timestamp` — the EVENT time, which is a different thing
            // from `created_at`, the row's write time. `ipAddress` was REMOVED
            // under the no-user-IPs-at-rest invariant: there is no column, and
            // this transform never reads the field, so a stale production
            // document carrying one leaves it behind.
            occurredAt: reqDate(doc, 'timestamp'),
            severity: str(doc, 'severity') ?? 'low',
            createdAt: date(doc, 'createdAt') ?? new Date(0),
            updatedAt: date(doc, 'updatedAt') ?? new Date(0),
          },
          documentId
        )
      );
    },
  },
];
