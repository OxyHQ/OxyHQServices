/**
 * The reputation bridge — the ONLY path by which a moderation decision becomes a
 * reputation consequence.
 *
 * THE DIRECTION IS ONE-WAY AND IS THE POINT. A moderation service never writes
 * reputation. It emits an authenticated event describing a decision it
 * published; this module validates that event and DERIVES the effect from the
 * policy version the decision names. The emitter states no points, no risk, no
 * duration and no standing. If it could, the reputation ledger would be an API
 * an application writes to, and every guarantee below would be advisory.
 *
 * FOUR OPERATIONS (§11.5), each doing distinct work:
 *  - {@link applyModerationDecision}     validate, derive, write — or record a skip.
 *  - {@link finalizeModerationDecision}  confirm the consequence landed and the
 *    snapshot reflects it. This is what a lost queue job is re-derived through.
 *  - {@link reverseModerationDecision}   an appeal succeeded: compensate the
 *    points and remove the active risk.
 *  - {@link reconcileModerationIncident} audit an incident end to end and repair
 *    a partially-applied consequence.
 *
 * WHAT MAKES "ONE PENALTY PER INCIDENT" TRUE
 *
 * Three independent guards, not one:
 *  1. `ModerationEffect` unique `(incidentId, principalId, effectType,
 *     decisionRevision)` — the semantic key. A hundred reports collapse to one
 *     incident and therefore one effect, whatever the transport did.
 *  2. `ModerationEffect` unique `eventId` — the transport key. A redelivery is
 *     answered from the stored effect.
 *  3. The ledger's existing unique `(applicationId, sourceActionId)`, with
 *     `sourceActionId` set to the idempotency key. Reused deliberately rather
 *     than reinvented: a second mechanism would be a second thing to get wrong,
 *     and this one already backs every other idempotent award.
 *
 * A pre-check makes the common retry cheap; the indexes make it CORRECT under
 * concurrency, which a pre-check alone never can.
 *
 * WHAT MAKES A CONSEQUENCE EXPLAINABLE AND REVERSIBLE
 *
 * Every effect stores the multipliers that produced it and all three policy
 * versions, so it can be recomputed under the policy it was decided under rather
 * than under today's tuning. Reversal is a COMPENSATING ledger entry — the
 * original transaction is never edited or deleted — plus a strike marked
 * `reversed`, so the history survives while the net balance and the active risk
 * are corrected.
 */

import mongoose, { type ClientSession } from 'mongoose';
import type {
  ModerationDecisionEvent,
  ModerationEffectSkipReason,
  ModerationEffectType,
  ModerationFinding,
  ModerationSeverity,
} from '@oxyhq/contracts';

import { ApplicationModerationTrust } from '../models/ApplicationModerationTrust';
import { ConductStrike, type IConductStrike } from '../models/ConductStrike';
import {
  ModerationEffect,
  type IModerationEffect,
} from '../models/ModerationEffect';
import {
  ModerationPolicy,
  type IConductStandingThreshold,
  type IModerationPolicy,
  type IModerationSeverityRule,
} from '../models/ModerationPolicy';
import { ReputationTransaction } from '../models/ReputationTransaction';
import reputationService from './reputation.service';
import { attestModerationEffect } from './civic/attestation.service';
import { resolveBindingProof } from './identityBinding.service';
import {
  MODERATION_CONDUCT_SOURCE_ACTION_TYPE,
  MODERATION_LEDGER_CATEGORY,
  MODERATION_VIOLATION_ACTIONS,
  REPORT_ABUSE_CONFIRMED_ACTION,
  REVIEW_ABUSE_CONFIRMED_ACTION,
} from '../utils/moderation.constants';
import { BadRequestError, NotFoundError } from '../utils/error';
import { logger } from '../utils/logger';
import { resolveUserIdToObjectId } from '../utils/validation';

/** Identity of the service credential the event arrived on. */
export interface ModerationEventContext {
  /** The emitting application (the moderation service), from its credential. */
  emitterApplicationId: string;
  /** The credential itself, recorded for audit. */
  emitterCredentialId?: string;
}

/** Outcome of {@link applyModerationDecision}. */
export interface ApplyResult {
  applied: boolean;
  effect?: IModerationEffect;
  skipReason?: ModerationEffectSkipReason;
  idempotent: boolean;
}

/** Outcome of {@link reverseModerationDecision}. */
export interface ReverseResult {
  reversed: IModerationEffect[];
  idempotent: boolean;
}

/** Outcome of {@link reconcileModerationIncident}. */
export interface ReconcileResult {
  incidentId: string;
  effectsExamined: number;
  /** Effects whose strike was missing or inconsistent and has been repaired. */
  strikesRepaired: number;
  /** Effects superseded by a later revision and now reversed. */
  supersededReversed: number;
  /** Subjects whose balance snapshot was recomputed. */
  balancesRecalculated: number;
}

/**
 * Severity ordering, used only to pick the PRIMARY finding. Kept here rather
 * than in the policy document because it is the definition of the words, not a
 * tunable: `critical` outranking `high` is not a policy choice.
 */
const SEVERITY_RANK: Readonly<Record<ModerationSeverity, number>> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Finding scopes that can reach the global ledger.
 *
 * `application_local` is excluded by design: the application enforces it itself
 * and Oxy Trust is not touched. That is not a limitation, it is the boundary
 * between "this community's rules" and "conduct against the network".
 */
const GLOBAL_FINDING_SCOPES: ReadonlySet<string> = new Set([
  'oxy_network',
  'identity_integrity',
]);

/**
 * Decision statuses that may produce an effect at all.
 *
 * `inconclusive` is its own outcome and produces nothing — it is neither guilt
 * nor innocence, and collapsing it into either would be the single most damaging
 * shortcut available here. `superseded` and `corrected` describe a revision a
 * later one replaced, so applying one would resurrect a consequence an appeal
 * removed.
 */
const EFFECTIVE_DECISION_STATUSES: ReadonlySet<string> = new Set(['final', 'provisional']);

/** Map a finding's attribution onto the axis its consequence lands on. */
function effectTypeForAttribution(finding: ModerationFinding): ModerationEffectType {
  switch (finding.attribution) {
    case 'reporter':
      return 'report_abuse_penalty';
    case 'reviewer':
      return 'review_abuse_penalty';
    case 'author':
    case 'sharer':
      return 'conduct_penalty';
  }
}

/** Ledger action key for an effect type and severity. */
function actionTypeFor(
  effectType: ModerationEffectType,
  severity: ModerationSeverity
): string {
  switch (effectType) {
    case 'report_abuse_penalty':
      return REPORT_ABUSE_CONFIRMED_ACTION;
    case 'review_abuse_penalty':
      return REVIEW_ABUSE_CONFIRMED_ACTION;
    case 'conduct_penalty':
      return MODERATION_VIOLATION_ACTIONS[severity];
  }
}

/**
 * The idempotency key for one consequence.
 *
 * Carries the incident, the revision, the SUBJECT and the AXIS. Dropping the
 * subject would collide when one incident finds both an author and a resharer in
 * violation; dropping the axis would collide when one person is both the author
 * and a colluding reviewer. Both are rare and both are real, and a collision
 * here does not error — it silently swallows the second legitimate consequence.
 */
export function buildIdempotencyKey(
  incidentId: string,
  decisionRevision: number,
  principalId: string,
  effectType: ModerationEffectType
): string {
  return `moderation:${incidentId}:${decisionRevision}:${principalId}:${effectType}`;
}

/** Round toward the nearest integer, keeping the sign of a penalty. */
function scale(base: number, multiplier: number): number {
  return Math.round(base * multiplier);
}

/**
 * The identifiers of a decision event, coerced to primitives.
 *
 * WHY THIS EXISTS RATHER THAN TRUSTING THE CALLER: every method on this service
 * is exported, and a queue worker, a reconciliation script or a future caller is
 * under no obligation to have passed a body through the route's schema. A Mongo
 * filter handed `{ $ne: null }` where it expects an id matches EVERY document —
 * for `findOne({ eventId })` that turns the transport idempotency check into
 * "some effect exists", and for a reversal it would reverse an unrelated one. So
 * the coercion lives where the query lives, not three layers up.
 *
 * The route's schema already rejects an object, which makes this defence in
 * depth rather than the only guard. Both are wanted: the schema gives a clean
 * 400 at the edge, this makes the service correct however it is reached.
 */
interface EventIdentifiers {
  eventId: string;
  incidentId: string;
  caseId: string;
  decisionId: string;
  decisionRevision: number;
  oxyConductVersion: string;
  principalId: string;
  bindingProofId: string;
  reportedApplicationId: string;
  occurredAt: Date;
  proofHash: string;
}

/**
 * Coerce a decision revision to a positive integer, or reject it.
 *
 * A silent `NaN` would be worse than an error: it matches no document, so a
 * reversal would report "no effect exists for that revision" and an operator
 * would go looking for a missing effect rather than a malformed request.
 */
function toDecisionRevision(value: unknown): number {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) {
    throw new BadRequestError('decisionRevision must be a positive integer');
  }
  return revision;
}

/** Coerce every identifier of an event that reaches a query or a write. */
function readEventIdentifiers(event: ModerationDecisionEvent): EventIdentifiers {
  const occurredAt = new Date(String(event.occurredAt));
  if (Number.isNaN(occurredAt.getTime())) {
    throw new BadRequestError('occurredAt must be a valid ISO 8601 timestamp');
  }
  return {
    eventId: String(event.eventId),
    incidentId: String(event.incidentId),
    caseId: String(event.caseId),
    decisionId: String(event.decisionId),
    decisionRevision: toDecisionRevision(event.decisionRevision),
    oxyConductVersion: String(event.policyVersions.oxyConduct),
    principalId: String(event.subject.principalId),
    bindingProofId: String(event.subject.bindingProofId),
    reportedApplicationId: String(event.reportedApplicationId),
    occurredAt,
    proofHash: String(event.proofHash),
  };
}

class ModerationReputationService {
  /**
   * Validate a decision event and derive its consequence.
   *
   * THE EIGHT PRE-EFFECT CHECKS, in the order they run and with the reason each
   * runs where it does:
   *
   *  1. EMITTER AUTHORITY — the caller holds `reputation:moderation:apply`.
   *     Enforced at the route, before this method is entered, because an
   *     unauthorized caller must not reach the derivation logic at all. What is
   *     re-checked here is only that the context carries a credential identity.
   *  2. NOT ALREADY PROCESSED — the `eventId` and the semantic key are both
   *     looked up, then enforced by unique indexes at write time.
   *  3. DECISION IS EFFECTIVE — `final`, or `provisional` when the resolved
   *     policy version permits provisional effects.
   *  4. BINDING PROOF — the binding resolves to the claimed principal, is
   *     active, belongs to the reported application, and was verified at or
   *     before the reported action.
   *  5. FINDING SCOPE — at least one finding reaches `oxy_network` or
   *     `identity_integrity`.
   *  6. POLICY RECOGNISES IT — the conduct family and the severity both exist in
   *     the named policy version. An unrecognised family produces nothing rather
   *     than a guess.
   *  7. INCIDENT NOT ALREADY PENALISED — one effect per incident, principal,
   *     axis and revision.
   *  8. NOT SUPERSEDED — a revision a later one replaced produces nothing.
   *
   * Checks 3, 5, 6 and the application gate return a SKIP rather than throwing:
   * they are legitimate outcomes of a well-formed event, and the emitter needs to
   * record "delivered, no effect" and stop retrying. Malformed input and missing
   * authority throw.
   */
  async applyModerationDecision(
    event: ModerationDecisionEvent,
    context: ModerationEventContext
  ): Promise<ApplyResult> {
    // (1) The emitter's authority is established by the route's scope check. A
    // context with no credential identity means the route was bypassed, which is
    // a programming error rather than a client one.
    if (!context.emitterApplicationId) {
      throw new BadRequestError('Moderation events require an emitting service credential');
    }

    // Every identifier this method queries or writes with is coerced ONCE, here.
    // See `readEventIdentifiers` for why the coercion belongs at the service
    // boundary rather than being trusted from the route's schema.
    const ids = readEventIdentifiers(event);

    // (2a) Transport-level replay: answer from the stored effect.
    const alreadySeen = await ModerationEffect.findOne({ eventId: ids.eventId });
    if (alreadySeen) {
      return { applied: true, effect: alreadySeen, idempotent: true };
    }

    // (8) A superseded or corrected revision must not be applied: a later
    // revision already replaced it, and applying this one would resurrect a
    // consequence an appeal removed.
    if (event.decisionStatus === 'superseded' || event.decisionStatus === 'corrected') {
      return { applied: false, skipReason: 'decision_superseded', idempotent: false };
    }

    // (3a) `inconclusive` is its own outcome. No effect, and never read as
    // "no violation".
    if (!EFFECTIVE_DECISION_STATUSES.has(event.decisionStatus)) {
      return { applied: false, skipReason: 'decision_not_effective', idempotent: false };
    }

    // (6a) The named policy version must exist. Falling back to the current one
    // would apply today's tuning to a decision made under another, which is
    // precisely what versioning exists to prevent.
    const policy = await ModerationPolicy.findOne({
      policyVersion: ids.oxyConductVersion,
    });
    if (!policy) {
      throw new BadRequestError(
        `Unknown Oxy conduct policy version: ${ids.oxyConductVersion}`
      );
    }

    // (3b) A provisional decision produces an effect only where the policy says
    // so. The baseline policy says no.
    if (event.decisionStatus === 'provisional' && !policy.provisionalEffectsAllowed) {
      return { applied: false, skipReason: 'decision_not_effective', idempotent: false };
    }

    // The reported application must itself be permitted to produce global
    // effects. An absent trust document is treated as `sandbox`: a newly
    // integrated application moderates locally and touches nothing global, so
    // forgetting to configure one fails safe.
    const reportedApplicationId = this.resolveApplicationId(ids.reportedApplicationId);
    const trust = await ApplicationModerationTrust.findOne({
      applicationId: reportedApplicationId,
    });
    if (!trust?.globalReputationEffectsAllowed) {
      return { applied: false, skipReason: 'application_not_permitted', idempotent: false };
    }

    const principalObjectId = await resolveUserIdToObjectId(ids.principalId);

    // (4) THE binding check. Without it, this whole module would be an API for
    // penalising an arbitrary user id.
    const binding = await resolveBindingProof({
      applicationId: ids.reportedApplicationId,
      bindingProofId: ids.bindingProofId,
      principalId: principalObjectId,
      occurredAt: ids.occurredAt,
    });
    if (!binding.ok) {
      return { applied: false, skipReason: binding.reason, idempotent: false };
    }

    // (5) + (6b) Keep only the findings that reach the network AND that this
    // policy version recognises.
    const eligible = this.selectEffectiveFindings(event.findings, policy);
    if (!eligible.ok) {
      return { applied: false, skipReason: eligible.reason, idempotent: false };
    }
    const { primary, rule, effectiveCount } = eligible;

    const effectType = effectTypeForAttribution(primary);
    const idempotencyKey = buildIdempotencyKey(
      ids.incidentId,
      ids.decisionRevision,
      principalObjectId,
      effectType
    );

    // (7) One effect per incident, principal, axis and revision. The pre-check
    // makes the common retry cheap; the unique index is what makes it correct
    // under concurrency.
    const existing = await ModerationEffect.findOne({
      incidentId: ids.incidentId,
      principalId: principalObjectId,
      effectType,
      decisionRevision: ids.decisionRevision,
    });
    if (existing) {
      return { applied: true, effect: existing, idempotent: true };
    }

    const repetitionMultiplier = await this.resolveRepetitionMultiplier(
      principalObjectId,
      primary.family,
      ids.incidentId,
      policy
    );
    const multiFindingMultiplier = Math.min(
      1 + policy.multiFindingSecondaryShare * (effectiveCount - 1),
      policy.multiFindingCap
    );
    const combined = repetitionMultiplier * multiFindingMultiplier;

    const points = scale(rule.points, combined);
    const activeRisk = scale(rule.riskPoints, combined);

    try {
      const effect = await this.writeEffect({
        event,
        ids,
        context,
        policy,
        primary,
        effectType,
        points,
        activeRisk,
        repetitionMultiplier,
        multiFindingMultiplier,
        idempotencyKey,
        principalObjectId,
        reportedApplicationId,
        bindingId: binding.binding._id,
        riskExpiryDays: rule.riskExpiryDays,
      });
      return { applied: true, effect, idempotent: false };
    } catch (error) {
      // A concurrent delivery won the race. Both unique indexes surface as
      // E11000; either way the winner is the answer, not an error.
      const duplicate = await this.findDuplicateWinner(error, {
        eventId: ids.eventId,
        incidentId: ids.incidentId,
        principalId: principalObjectId,
        effectType,
        decisionRevision: ids.decisionRevision,
      });
      if (duplicate) {
        return { applied: true, effect: duplicate, idempotent: true };
      }
      throw error;
    }
  }

  /**
   * Confirm that a decision revision's consequence exists and that the subject's
   * snapshot reflects it.
   *
   * This is the operation a lost dispatch is recovered through: the effect and
   * its strike are the durable record, so re-deriving the snapshot from them is
   * always safe and never double-counts. It creates nothing — an effect that was
   * never applied cannot be conjured from a decision id alone, and pretending
   * otherwise would invent a consequence.
   */
  async finalizeModerationDecision(
    decisionId: string,
    decisionRevision: number
  ): Promise<IModerationEffect[]> {
    // Coerced for the same reason `readEventIdentifiers` exists: this method is
    // exported, and a filter handed an operator object here would report on
    // effects belonging to other decisions entirely.
    const effects = await ModerationEffect.find({
      decisionId: String(decisionId),
      decisionRevision: toDecisionRevision(decisionRevision),
    });
    if (effects.length === 0) {
      throw new NotFoundError('No moderation effect exists for that decision revision');
    }

    const subjects = new Set(effects.map((effect) => effect.principalId.toString()));
    for (const subject of subjects) {
      await reputationService.recalculateBalance(subject);
    }
    return effects;
  }

  /**
   * An appeal overturned a decision revision: compensate the points and remove
   * the active risk.
   *
   * The ledger is append-only, so the correction is a COMPENSATING entry — the
   * original transaction keeps its points and is marked `reversed`, and the pair
   * nets to zero. Nothing is edited and nothing disappears; what changes is the
   * net balance and the active risk.
   *
   * ORDER MATTERS. The strike is marked `reversed` BEFORE the compensating entry
   * is appended, because `reverseTransaction` recomputes the balance and must see
   * the risk already gone. If the process dies between the two writes, the
   * person is out from under the consequence with their points not yet
   * compensated — the recoverable direction. The opposite order would leave
   * someone whose appeal SUCCEEDED still carrying active risk, which is the
   * failure this operation exists to prevent. Every step is idempotent, so a
   * retry completes the rest.
   */
  async reverseModerationDecision(
    decisionId: string,
    decisionRevision: number,
    reason: string
  ): Promise<ReverseResult> {
    // Coerced before it reaches the filter: reversing on an operator object
    // would compensate an unrelated decision's consequence, which is the worst
    // failure available on this path.
    const effects = await ModerationEffect.find({
      decisionId: String(decisionId),
      decisionRevision: toDecisionRevision(decisionRevision),
    });
    if (effects.length === 0) {
      throw new NotFoundError('No moderation effect exists for that decision revision');
    }

    const pending = effects.filter((effect) => effect.status === 'applied');
    if (pending.length === 0) {
      return { reversed: effects, idempotent: true };
    }

    for (const effect of pending) {
      if (effect.strikeId) {
        await ConductStrike.updateOne(
          { _id: effect.strikeId, status: 'active' },
          { $set: { status: 'reversed', resolvedAt: new Date() } }
        );
      }

      const { reversal } = await reputationService.reverseTransaction(
        effect.transactionId.toString(),
        { reason: `Moderation decision reversed: ${reason}` }
      );

      effect.status = 'reversed';
      effect.reversalTransactionId = reversal._id;
      effect.reversedAt = new Date();
      effect.reversalReason = reason;
      await effect.save();
    }

    return { reversed: effects, idempotent: false };
  }

  /**
   * Audit an incident end to end and repair a partially-applied consequence.
   *
   * Two failure shapes this exists for, both of which a dropped background job
   * can produce: an effect whose strike never landed (points deducted, no
   * standing change) and an effect from a revision a later one superseded
   * (consequence still active after an appeal). Both are silent — nothing errors,
   * the numbers are simply wrong — so a reconciliation pass is the only thing
   * that finds them.
   *
   * Idempotent: a healthy incident is examined and nothing is written.
   */
  async reconcileModerationIncident(incidentId: string): Promise<ReconcileResult> {
    const incident = String(incidentId);
    const effects = await ModerationEffect.find({ incidentId: incident }).sort({
      decisionRevision: 1,
    });

    const latestRevision = effects.reduce(
      (max, effect) => Math.max(max, effect.decisionRevision),
      0
    );
    const touched = new Set<string>();
    let strikesRepaired = 0;
    let supersededReversed = 0;

    for (const effect of effects) {
      // An applied effect from a superseded revision is a consequence an appeal
      // should already have removed.
      if (effect.status === 'applied' && effect.decisionRevision < latestRevision) {
        await this.reverseModerationDecision(
          effect.decisionId,
          effect.decisionRevision,
          `Superseded by revision ${latestRevision}`
        );
        supersededReversed += 1;
        touched.add(effect.principalId.toString());
        continue;
      }

      if (effect.status !== 'applied' || effect.activeRisk === 0) {
        continue;
      }

      // The strike is what carries active risk. Without it the points were
      // deducted and the standing never moved.
      const strike = effect.strikeId
        ? await ConductStrike.findById(effect.strikeId)
        : null;
      if (!strike) {
        const repaired = await this.createStrike({
          effect,
          family: effect.family,
          expiresAt: undefined,
        });
        effect.strikeId = repaired._id;
        await effect.save();
        strikesRepaired += 1;
        touched.add(effect.principalId.toString());
      }
    }

    for (const subject of touched) {
      await reputationService.recalculateBalance(subject);
    }

    return {
      incidentId: incident,
      effectsExamined: effects.length,
      strikesRepaired,
      supersededReversed,
      balancesRecalculated: touched.size,
    };
  }

  /**
   * Expire the active strikes whose risk has lapsed.
   *
   * The ledger transaction stays exactly where it is: the history is permanent,
   * only the consequence decays. That combination is what stops a minor error
   * from becoming a life sentence while keeping the record honest. Critical
   * strikes carry no `expiresAt` and so are never selected — they need a
   * specialised recovery review, not a timer.
   *
   * @param limit - Ceiling on strikes expired in one pass, so a backlog cannot
   *   stall a scheduled tick.
   */
  async expireConductStrikes(limit: number): Promise<{ expired: number; subjects: number }> {
    const due = await ConductStrike.find({
      status: 'active',
      expiresAt: { $lte: new Date() },
    })
      .sort({ expiresAt: 1 })
      .limit(limit);

    if (due.length === 0) {
      return { expired: 0, subjects: 0 };
    }

    const subjects = new Set<string>();
    for (const strike of due) {
      strike.status = 'expired';
      strike.resolvedAt = new Date();
      await strike.save();
      subjects.add(strike.userId.toString());
    }

    for (const subject of subjects) {
      await reputationService.recalculateBalance(subject);
    }

    logger.info('Conduct risk expired', {
      component: 'moderationReputation',
      expired: due.length,
      subjects: subjects.size,
    });

    return { expired: due.length, subjects: subjects.size };
  }

  /**
   * Seed the baseline Oxy Conduct Policy. Idempotent, and deliberately NOT an
   * upsert of the values: a published policy version is immutable, so an existing
   * document is left exactly as it is. Changing a tuning means publishing a new
   * version, not editing the one past decisions were made under.
   */
  async seedBaselinePolicy(params: {
    policyVersion: string;
    severityRules: readonly IModerationSeverityRule[];
    conductFamilies: readonly string[];
    repetitionMultipliers: readonly number[];
    repetitionWindowDays: number;
    multiFindingSecondaryShare: number;
    multiFindingCap: number;
    standingThresholds: readonly IConductStandingThreshold[];
  }): Promise<IModerationPolicy> {
    const existing = await ModerationPolicy.findOne({ policyVersion: params.policyVersion });
    if (existing) {
      return existing;
    }
    return ModerationPolicy.create({
      policyVersion: params.policyVersion,
      status: 'active',
      severityRules: [...params.severityRules],
      conductFamilies: [...params.conductFamilies],
      repetitionMultipliers: [...params.repetitionMultipliers],
      repetitionWindowDays: params.repetitionWindowDays,
      multiFindingSecondaryShare: params.multiFindingSecondaryShare,
      multiFindingCap: params.multiFindingCap,
      standingThresholds: [...params.standingThresholds],
      provisionalEffectsAllowed: false,
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /**
   * Keep the findings this policy version can act on, and pick the primary.
   *
   * Returns the most specific reason when nothing qualifies, so an emitter can
   * tell "we do not act on local findings" apart from "your taxonomy names a
   * family we do not recognise" — two very different things to fix.
   */
  private selectEffectiveFindings(
    findings: readonly ModerationFinding[],
    policy: IModerationPolicy
  ):
    | {
        ok: true;
        primary: ModerationFinding;
        rule: IModerationSeverityRule;
        effectiveCount: number;
      }
    | { ok: false; reason: ModerationEffectSkipReason } {
    const globalScoped = findings.filter((finding) => GLOBAL_FINDING_SCOPES.has(finding.scope));
    if (globalScoped.length === 0) {
      return { ok: false, reason: 'finding_scope_local' };
    }

    const families = new Set(policy.conductFamilies);
    const recognised = globalScoped.filter(
      (finding) =>
        families.has(finding.family) &&
        policy.severityRules.some((rule) => rule.severity === finding.severity)
    );
    if (recognised.length === 0) {
      return { ok: false, reason: 'finding_not_in_policy' };
    }

    // The primary is the most severe recognised finding. Ties keep the emitter's
    // order, so the same event always derives the same effect.
    //
    // `family` is re-read as a primitive: it reaches a Mongo filter in the
    // repetition lookup, and the same reasoning as `readEventIdentifiers`
    // applies — a filter handed an operator object there would count every prior
    // strike as similar and escalate the penalty.
    const worst = recognised.reduce((current, finding) =>
      SEVERITY_RANK[finding.severity] > SEVERITY_RANK[current.severity] ? finding : current
    );
    const primary: ModerationFinding = { ...worst, family: String(worst.family) };
    const rule = policy.severityRules.find((entry) => entry.severity === primary.severity);
    if (!rule) {
      return { ok: false, reason: 'finding_not_in_policy' };
    }

    return { ok: true, primary, rule, effectiveCount: recognised.length };
  }

  /**
   * Repetition multiplier for a subject and conduct family.
   *
   * Similarity is by FAMILY and time window, never by taxonomy code, so
   * relabelling the same behaviour does not reset the counter — and, in the other
   * direction, stacking labels on one incident cannot manufacture repetition.
   * Prior incidents are counted as DISTINCT `incidentId`s, and reversed strikes
   * are excluded: a decision that was overturned is not a prior offence.
   */
  private async resolveRepetitionMultiplier(
    principalId: string,
    family: string,
    incidentId: string,
    policy: IModerationPolicy
  ): Promise<number> {
    const multipliers = policy.repetitionMultipliers;
    if (multipliers.length === 0) {
      return 1;
    }

    const since = new Date(Date.now() - policy.repetitionWindowDays * 24 * 60 * 60 * 1000);
    const priors = await ConductStrike.find({
      userId: new mongoose.Types.ObjectId(principalId),
      family: String(family),
      status: { $ne: 'reversed' },
      incidentId: { $ne: String(incidentId) },
      createdAt: { $gte: since },
    }).select('incidentId');

    const distinctIncidents = new Set(priors.map((strike) => strike.incidentId));
    const ordinal = Math.min(distinctIncidents.size, multipliers.length - 1);
    return multipliers[ordinal];
  }

  /**
   * Write the consequence: ledger transaction, strike and effect record.
   *
   * All three commit in ONE transaction where the deployment supports it, so the
   * three guards cannot end up disagreeing about whether a consequence exists.
   * The attestation is emitted afterwards and is non-fatal — a signing failure
   * must never roll back a consequence, and a consequence with no attestation is
   * recoverable while a rolled-back one is invisible.
   */
  private async writeEffect(params: {
    event: ModerationDecisionEvent;
    /** The event's identifiers, already coerced at the service boundary. */
    ids: EventIdentifiers;
    context: ModerationEventContext;
    policy: IModerationPolicy;
    primary: ModerationFinding;
    effectType: ModerationEffectType;
    points: number;
    activeRisk: number;
    repetitionMultiplier: number;
    multiFindingMultiplier: number;
    idempotencyKey: string;
    principalObjectId: string;
    reportedApplicationId: mongoose.Types.ObjectId;
    bindingId: mongoose.Types.ObjectId;
    riskExpiryDays: number | null;
  }): Promise<IModerationEffect> {
    // Only what this method itself logs or attests. The three writes take the
    // whole `params` object, so destructuring the rest here would be a second,
    // drifting copy of the same values.
    const {
      ids,
      context,
      policy,
      primary,
      effectType,
      points,
      activeRisk,
      idempotencyKey,
      principalObjectId,
      reportedApplicationId,
      bindingId,
    } = params;

    const session = await mongoose.startSession();
    let effect: IModerationEffect | undefined;
    try {
      await session.withTransaction(async () => {
        effect = await this.writeEffectInSession(params, session);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transactionsUnsupported =
        message.includes('Transaction numbers are only allowed') ||
        message.includes('replica set') ||
        message.includes('does not support transactions');
      if (!transactionsUnsupported) {
        throw error;
      }
      logger.warn(
        'Moderation effect written without a transaction (deployment does not support them)',
        { component: 'moderationReputation' }
      );
      effect = await this.writeEffectInSession(params, undefined);
    } finally {
      await session.endSession();
    }

    if (!effect) {
      throw new Error('Moderation effect write produced no record');
    }

    // Provenance, deliberately minimal: a severity BAND, the points, the hash of
    // the private decision and the policy version. No taxonomy code, no victim,
    // no content — an attestation is exportable, and a sanction ledger that names
    // categories would be worse than no attestation at all.
    try {
      await attestModerationEffect({
        transactionId: effect.transactionId.toString(),
        subjectUserId: principalObjectId,
        severityBand: primary.severity,
        points,
        decisionHash: ids.proofHash,
        policyVersion: policy.policyVersion,
        sourceActionId: idempotencyKey,
      });
    } catch (error) {
      logger.warn('Moderation attestation emission failed (non-fatal)', {
        component: 'moderationReputation',
        effectId: effect._id.toString(),
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.info('Moderation reputation effect applied', {
      component: 'moderationReputation',
      incidentId: ids.incidentId,
      decisionRevision: ids.decisionRevision,
      effectType,
      severity: primary.severity,
      points,
      activeRisk,
      reportedApplicationId: reportedApplicationId.toString(),
      emitterApplicationId: context.emitterApplicationId,
      bindingId: bindingId.toString(),
    });

    return effect;
  }

  /** The three writes themselves, so they can run with or without a session. */
  private async writeEffectInSession(
    params: Parameters<ModerationReputationService['writeEffect']>[0],
    session: ClientSession | undefined
  ): Promise<IModerationEffect> {
    const {
      ids,
      context,
      policy,
      primary,
      effectType,
      points,
      activeRisk,
      repetitionMultiplier,
      multiFindingMultiplier,
      idempotencyKey,
      principalObjectId,
      reportedApplicationId,
      bindingId,
      riskExpiryDays,
    } = params;

    const transaction = await reputationService.award({
      userId: principalObjectId,
      actionType: actionTypeFor(effectType, primary.severity),
      applicationId: reportedApplicationId.toString(),
      // The idempotency key IS the ledger's `sourceActionId`, so the existing
      // unique `(applicationId, sourceActionId)` index becomes the third guard
      // against a double penalty. Reused rather than reinvented.
      sourceActionId: idempotencyKey,
      sourceActionType: MODERATION_CONDUCT_SOURCE_ACTION_TYPE,
      targetEntityId: ids.incidentId,
      targetEntityType: 'manual_review',
      reason: `Moderation decision ${ids.decisionId} revision ${ids.decisionRevision}`,
      // Metadata names no taxonomy code, no reporter and no content — the ledger
      // is readable by its subject, and a sanction row must explain itself
      // without becoming a dossier.
      metadata: {
        incidentId: ids.incidentId,
        decisionRevision: ids.decisionRevision,
        severity: primary.severity,
        family: primary.family,
      },
      ruleOverride: {
        points,
        category: MODERATION_LEDGER_CATEGORY,
        description: `Moderation conduct effect (${primary.severity})`,
        policyVersion: policy.policyVersion,
      },
      session,
    });

    let strike: IConductStrike | undefined;
    if (activeRisk !== 0) {
      const expiresAt =
        riskExpiryDays === null
          ? undefined
          : new Date(Date.now() + riskExpiryDays * 24 * 60 * 60 * 1000);
      const created = await ConductStrike.create(
        [
          {
            userId: new mongoose.Types.ObjectId(principalObjectId),
            incidentId: ids.incidentId,
            decisionId: ids.decisionId,
            decisionRevision: ids.decisionRevision,
            applicationId: reportedApplicationId,
            effectType,
            severity: primary.severity,
            riskPoints: activeRisk,
            family: primary.family,
            status: 'active',
            expiresAt,
            policyVersion: policy.policyVersion,
            transactionId: transaction._id,
          },
        ],
        session ? { session } : {}
      );
      strike = created[0];
    }

    const createdEffect = await ModerationEffect.create(
      [
        {
          eventId: ids.eventId,
          incidentId: ids.incidentId,
          caseId: ids.caseId,
          decisionId: ids.decisionId,
          decisionRevision: ids.decisionRevision,
          principalId: new mongoose.Types.ObjectId(principalObjectId),
          bindingId,
          applicationId: reportedApplicationId,
          credentialId: context.emitterCredentialId
            ? new mongoose.Types.ObjectId(context.emitterCredentialId)
            : undefined,
          effectType,
          status: 'applied',
          points,
          activeRisk,
          severity: primary.severity,
          family: primary.family,
          repetitionMultiplier,
          multiFindingMultiplier,
          idempotencyKey,
          transactionId: transaction._id,
          strikeId: strike?._id,
          policyVersions: {
            universal: String(params.event.policyVersions.universal),
            application: String(params.event.policyVersions.application),
            oxyConduct: ids.oxyConductVersion,
          },
          proofHash: ids.proofHash,
          appliedAt: new Date(),
        },
      ],
      session ? { session } : {}
    );

    // The strike changed the subject's active risk, so the snapshot must be
    // recomputed inside the same unit of work — otherwise a reader between the
    // two sees points deducted and standing unchanged.
    await reputationService.recalculateBalance(principalObjectId, session);

    return createdEffect[0];
  }

  /**
   * Resolve the winner of a duplicate-key race.
   *
   * Both unique indexes and the ledger's own surface as E11000, and which one
   * fired does not matter: the stored effect is the answer either way. Returns
   * `null` for any other error so the caller rethrows rather than swallowing it.
   */
  private async findDuplicateWinner(
    error: unknown,
    key: {
      eventId: string;
      incidentId: string;
      principalId: string;
      effectType: ModerationEffectType;
      decisionRevision: number;
    }
  ): Promise<IModerationEffect | null> {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: number }).code
        : undefined;
    if (code !== 11000) {
      return null;
    }
    const byEvent = await ModerationEffect.findOne({ eventId: String(key.eventId) });
    if (byEvent) {
      return byEvent;
    }
    return ModerationEffect.findOne({
      incidentId: String(key.incidentId),
      principalId: new mongoose.Types.ObjectId(key.principalId),
      effectType: key.effectType,
      decisionRevision: Number(key.decisionRevision),
    });
  }

  /** Repair a missing strike from its effect, preserving the original figures. */
  private async createStrike(params: {
    effect: IModerationEffect;
    family: string;
    expiresAt: Date | undefined;
  }): Promise<IConductStrike> {
    const { effect, family, expiresAt } = params;
    return ConductStrike.create({
      userId: effect.principalId,
      incidentId: effect.incidentId,
      decisionId: effect.decisionId,
      decisionRevision: effect.decisionRevision,
      applicationId: effect.applicationId,
      effectType: effect.effectType,
      severity: effect.severity,
      riskPoints: effect.activeRisk,
      family,
      status: 'active',
      expiresAt,
      policyVersion: effect.policyVersions.oxyConduct,
      transactionId: effect.transactionId,
    });
  }

  /** Validate and convert an application id from the event. */
  private resolveApplicationId(value: string): mongoose.Types.ObjectId {
    if (!mongoose.Types.ObjectId.isValid(value)) {
      throw new BadRequestError('Invalid reportedApplicationId');
    }
    return new mongoose.Types.ObjectId(value);
  }

  /**
   * The ledger transaction an effect produced, for the owner-facing explanation
   * surface. Kept here rather than on the reputation service because the join
   * from effect to transaction is a bridge concern.
   */
  async getEffectTransaction(effect: IModerationEffect) {
    return ReputationTransaction.findById(effect.transactionId);
  }
}

export const moderationReputationService = new ModerationReputationService();
export default moderationReputationService;
