/**
 * Identity binding — the primitive that makes "no binding proof, no Oxy Trust
 * effect" enforceable rather than aspirational.
 *
 * Before this module, an application reporting moderation could name any Oxy
 * user id and be believed: `award` accepted a bare id. That is the hole the
 * whole reputation bridge is built around, so the binding is not a formality —
 * it is the authorization boundary.
 *
 * WHAT COUNTS AS PROOF, strongest first:
 *
 *  1. `oauth_grant` — the user authorized the application through Oxy's own
 *     OAuth flow, and Oxy wrote the `AppGrant` row itself. The application
 *     asserts nothing, and `firstGrantedAt` is Oxy's own record of when the
 *     person was present. This is preferred whenever a grant exists, even when
 *     the registration call arrives later, because an earlier verifiable instant
 *     covers strictly more reported actions.
 *  2. `session_proof` — the application presents the USER'S OWN Oxy access
 *     token alongside its service credential. An application can only hold that
 *     token if the person signed in to it through Oxy, so it proves presence.
 *     This path exists because trusted first-party applications are
 *     auto-approved at authorize time and record NO grant — without it, exactly
 *     the applications closest to Oxy would be the ones unable to prove
 *     anything.
 *
 * NO PROOF MATERIAL IS PERSISTED. The token is verified and discarded; what
 * survives is that the check passed and when. Storing it would turn this
 * collection into a credential store, which a binding record is not worth.
 *
 * The time comparison is the part most easily mistaken for decoration. A
 * binding created AFTER the reported action proves that the person is in the
 * application now, not that they were the actor then — so
 * {@link resolveBindingProof} rejects it.
 */

import mongoose from 'mongoose';
import type { ModerationEffectSkipReason } from '@oxyhq/contracts';

import { AppGrant } from '../models/AppGrant';
import { IdentityBinding, type IIdentityBinding } from '../models/IdentityBinding';
import { validateSessionToken } from '../middleware/authUtils';
import { BadRequestError, UnauthorizedError } from '../utils/error';
import { logger } from '../utils/logger';

/** What the registering application supplies, plus what its credential proved. */
export interface RegisterBindingParams {
  /** Resolved from the service credential — never from the request body. */
  applicationId: string;
  /** The credential that presented the proof, recorded for audit only. */
  credentialId?: string;
  /** The application's own identifier for this person. */
  localPrincipalId: string;
  /** The USER'S Oxy access token. Verified, then discarded. */
  userProofToken: string;
}

/** A binding resolution that produced a usable proof. */
export interface BindingResolved {
  ok: true;
  binding: IIdentityBinding;
}

/** A binding resolution that did not, and precisely why. */
export interface BindingRejected {
  ok: false;
  reason: Extract<
    ModerationEffectSkipReason,
    'no_binding_proof' | 'binding_after_action' | 'binding_principal_mismatch' | 'binding_revoked'
  >;
}

export type BindingResolution = BindingResolved | BindingRejected;

function toObjectId(value: string, field: string): mongoose.Types.ObjectId {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new BadRequestError(`Invalid ${field}`);
  }
  return new mongoose.Types.ObjectId(value);
}

/**
 * Register (or refresh) the binding between an Oxy user and a local principal in
 * the calling application.
 *
 * Verifies the user's own access token, then takes the EARLIEST verifiable
 * instant of presence: an existing `AppGrant` beats the current moment, because
 * consent Oxy itself recorded is both stronger evidence and covers more of the
 * past. An application cannot make its binding look older than its evidence —
 * `verifiedAt` is derived here, never accepted from the caller.
 *
 * Rebinding a local principal to a DIFFERENT Oxy user revokes the previous
 * binding rather than overwriting it: a past effect references that row, and its
 * original `verifiedAt` is what made the effect legitimate.
 *
 * @throws UnauthorizedError when the user proof token does not resolve.
 */
export async function registerIdentityBinding(
  params: RegisterBindingParams
): Promise<IIdentityBinding> {
  const applicationId = toObjectId(params.applicationId, 'applicationId');
  const credentialId = params.credentialId
    ? toObjectId(params.credentialId, 'credentialId')
    : undefined;

  const proofUser = await validateSessionToken(params.userProofToken);
  if (!proofUser) {
    throw new UnauthorizedError('The user proof token is invalid or expired');
  }
  const userId = toObjectId(proofUser._id, 'userProofToken subject');

  // Prefer Oxy's own record of consent when one exists: it predates this call
  // and the application asserted none of it.
  const grant = await AppGrant.findOne({ userId, applicationId })
    .select('firstGrantedAt')
    .lean<{ firstGrantedAt?: Date } | null>();
  const bindingType = grant ? 'oauth_grant' : 'session_proof';
  const verifiedAt = grant?.firstGrantedAt ?? new Date();

  const existing = await IdentityBinding.findOne({
    applicationId,
    localPrincipalId: params.localPrincipalId,
    status: 'active',
  });

  if (existing && !existing.userId.equals(userId)) {
    existing.status = 'revoked';
    existing.revokedAt = new Date();
    await existing.save();
    logger.warn('Identity binding rebound to a different Oxy user', {
      component: 'identityBinding',
      applicationId: params.applicationId,
      bindingId: existing._id.toString(),
    });
  } else if (existing) {
    // Same person: keep the earliest proven instant. A refresh must never move
    // `verifiedAt` forward, or re-registering would retroactively invalidate the
    // reported actions the original binding already covered.
    if (verifiedAt < existing.verifiedAt) {
      existing.verifiedAt = verifiedAt;
      existing.bindingType = bindingType;
    }
    existing.credentialId = credentialId;
    await existing.save();
    return existing;
  }

  return IdentityBinding.create({
    applicationId,
    userId,
    localPrincipalId: params.localPrincipalId,
    bindingType,
    status: 'active',
    verifiedAt,
    credentialId,
  });
}

/** What {@link resolveBindingProof} needs in order to decide. */
export interface ResolveBindingParams {
  /**
   * The application the reported action happened in. The lookup is SCOPED to it,
   * so a binding another application holds is simply not found — an emitter
   * cannot borrow a proof from a tenant it does not speak for.
   */
  applicationId: string;
  /** The `bindingProofId` the event carried. */
  bindingProofId: string;
  /** The Oxy user the event claims the actor resolves to. */
  principalId: string;
  /** When the REPORTED ACTION happened. */
  occurredAt: Date;
}

/**
 * Decide whether a binding proves that `principalId` was the actor at
 * `occurredAt` in `applicationId`.
 *
 * Returns a rejection rather than throwing: a missing or stale binding is a
 * legitimate outcome of a well-formed event, and the emitter must be able to
 * record "delivered, no effect" and stop retrying instead of hammering a
 * permanent error.
 */
export async function resolveBindingProof(
  params: ResolveBindingParams
): Promise<BindingResolution> {
  if (!mongoose.Types.ObjectId.isValid(params.bindingProofId)) {
    return { ok: false, reason: 'no_binding_proof' };
  }

  const binding = await IdentityBinding.findOne({
    _id: new mongoose.Types.ObjectId(params.bindingProofId),
    applicationId: toObjectId(params.applicationId, 'applicationId'),
  });
  if (!binding) {
    return { ok: false, reason: 'no_binding_proof' };
  }

  if (!binding.userId.equals(toObjectId(params.principalId, 'principalId'))) {
    return { ok: false, reason: 'binding_principal_mismatch' };
  }

  // A revoked binding is a statement that the mapping was withdrawn or wrong.
  // Refusing to penalise on a withdrawn proof is the conservative direction, and
  // effects already applied keep referencing the row for audit.
  if (binding.status !== 'active') {
    return { ok: false, reason: 'binding_revoked' };
  }

  // THE time check. A binding verified after the action proves the person is in
  // the application now, not that they were the actor then.
  if (binding.verifiedAt.getTime() > params.occurredAt.getTime()) {
    return { ok: false, reason: 'binding_after_action' };
  }

  return { ok: true, binding };
}
