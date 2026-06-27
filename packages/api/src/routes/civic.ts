/**
 * Civic / Commons Routes (Fase 1 — public DNI card; Fase 2 — real-life attestation)
 *
 * Mounted at `/civic` (beside `/identity`):
 *  - `GET  /civic/:userId/card`   — the user's signed, verifiable "DNI" card (public).
 *  - `POST /civic/attestations`   — submit a real-life counterparty attestation (auth).
 *
 * The card route is public, cacheable, CORS-open (`Access-Control-Allow-Origin:
 * *`), no auth/CSRF — a public card is meant to be scanned by anyone. The
 * attestation route is Bearer-authenticated (the counterparty submits a record
 * they signed with their own key), so no app-local CSRF (bearer-write rule).
 * More civic routes (validations, personhood) arrive in Fase 2 Part B / Fase 3.
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, serviceAuthMiddleware, AuthRequest, ServiceAuthRequest } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimiter';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../utils/error';
import { isValidObjectId } from '../utils/validation';
import {
  signedRecordEnvelopeSchema,
  validationOpenRequestSchema,
  type SignedRecordEnvelope,
} from '@oxyhq/contracts';
import { buildSignedPublicCard } from '../services/civic/publicCard.service';
import { submitRealLifeAttestation, type RealLifeRejectionReason } from '../services/civic/realLife.service';
import {
  openValidationRequest,
  submitVote,
  denyValidation,
  getValidatorInbox,
  type VoteRejectionReason,
} from '../services/civic/validator.service';

const router = Router();

const attestationLimiter = rateLimit({
  prefix: 'rl:civic:attest:',
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many attestation submissions. Please slow down.',
  keyGenerator: (req: Request): string => {
    const userId = (req as AuthRequest).user?.id;
    return userId ? `civic:attest:${userId}` : `civic:attest:ip:${req.ip ?? 'unknown'}`;
  },
});

const validationLimiter = rateLimit({
  prefix: 'rl:civic:validate:',
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many validation requests. Please slow down.',
  keyGenerator: (req: Request): string => {
    const userId = (req as AuthRequest).user?.id;
    return userId ? `civic:validate:${userId}` : `civic:validate:ip:${req.ip ?? 'unknown'}`;
  },
});

/** Map a vote rejection reason to the HTTP error the route should throw. */
function throwForVoteReason(reason: VoteRejectionReason): never {
  switch (reason) {
    case 'request_not_found':
      throw new NotFoundError('Validation request not found');
    case 'request_closed':
    case 'already_voted':
      throw new ConflictError(`Vote rejected: ${reason}`);
    case 'not_selected':
      throw new ForbiddenError('You are not on this validation jury');
    default:
      throw new BadRequestError(`Vote rejected: ${reason}`);
  }
}

/** Map a real-life rejection reason to the HTTP error the route should throw. */
function throwForRealLifeReason(reason: RealLifeRejectionReason): never {
  switch (reason) {
    case 'subject_not_found':
      throw new NotFoundError('Attestation subject not found');
    case 'nonce_used':
    case 'pair_cooldown':
    case 'chain_conflict':
    case 'bad_seq':
    case 'chain_fork':
      throw new ConflictError(`Attestation rejected: ${reason}`);
    case 'self_attestation':
    case 'excluded_graph_neighbor':
    case 'excluded_shared_device':
    case 'excluded_shared_ip':
      throw new ForbiddenError(`Attestation rejected: ${reason}`);
    default:
      throw new BadRequestError(`Attestation rejected: ${reason}`);
  }
}

/** Headers shared by every public civic response. */
function setPublicCardHeaders(res: Response): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=60');
}

/**
 * GET /civic/:userId/card — the user's signed public DNI card (public).
 * Returns `{ card, attestation }`; `attestation` is `null` only when the Oxy
 * signing key is unconfigured (dev). Unknown / invalid id → 404.
 */
router.get(
  '/:userId/card',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      throw new NotFoundError('Card not found');
    }

    const signed = await buildSignedPublicCard(userId);
    if (!signed) {
      throw new NotFoundError('Card not found');
    }

    setPublicCardHeaders(res);
    res.json(signed);
  }),
);

/**
 * POST /civic/attestations — submit a real-life counterparty attestation (auth).
 * Body is the counterparty's signed `real_life_attestation` envelope; the server
 * verifies it, enforces nonce single-use + freshness + graph-exclusion + the
 * per-pair cooldown, stores it, and awards the subject the HIGH-weight points.
 * Returns `RealLifeAttestationResult` on success.
 */
router.post(
  '/attestations',
  authMiddleware,
  attestationLimiter,
  validate({ body: signedRecordEnvelopeSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const attestorUserId = req.user?._id?.toString();
    if (!attestorUserId) {
      throw new UnauthorizedError('Authentication required');
    }

    const result = await submitRealLifeAttestation(req.body as SignedRecordEnvelope, attestorUserId);
    if (!result.ok) {
      throwForRealLifeReason(result.reason);
    }

    res.status(201).json({
      accepted: true,
      recordId: result.recordId,
      subjectUserId: result.subjectUserId,
      attestorUserId: result.attestorUserId,
      points: result.points,
    });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Validator jury (Fase 2 Part B)                                            */
/* -------------------------------------------------------------------------- */

/**
 * POST /civic/validations — open a validation request (service-token only).
 * An internal service opens a request on behalf of a user action; the jury is
 * selected server-side. Returns `{ requestId, selectedValidatorCount, expiresAt }`.
 */
router.post(
  '/validations',
  serviceAuthMiddleware,
  validationLimiter,
  validate({ body: validationOpenRequestSchema }),
  asyncHandler(async (req: ServiceAuthRequest, res: Response) => {
    const { subjectUserId, actionType, sourceActionId, payload, highValue } = req.body;
    if (!isValidObjectId(subjectUserId)) {
      throw new BadRequestError('Invalid subjectUserId');
    }

    const request = await openValidationRequest({
      subjectUserId,
      actionType,
      sourceActionId,
      payload,
      highValue,
      applicationId: req.serviceApp?.appId,
    });

    res.status(201).json({
      requestId: request._id.toString(),
      selectedValidatorCount: request.selectedValidatorIds.length,
      expiresAt: request.expiresAt.toISOString(),
    });
  }),
);

/**
 * GET /civic/validations/inbox — the caller's pending jury duties (auth).
 * Returns `{ requests: ValidationRequestSummary[] }`.
 */
router.get(
  '/validations/inbox',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const requests = await getValidatorInbox(userId);
    res.json({
      requests: requests.map((request) => ({
        id: request._id.toString(),
        subjectUserId: request.subjectUserId.toString(),
        actionType: request.actionType,
        payload: request.payload,
        payloadHash: request.payloadHash,
        status: request.status,
        highValue: request.highValue,
        expiresAt: request.expiresAt.toISOString(),
      })),
    });
  }),
);

/**
 * POST /civic/validations/:id/vote — cast a SIGNED verdict (auth). Body is the
 * juror's `validation_verdict` envelope. Returns `ValidationVoteResult`.
 */
router.post(
  '/validations/:id/vote',
  authMiddleware,
  validationLimiter,
  validate({ body: signedRecordEnvelopeSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    if (!isValidObjectId(req.params.id)) {
      throw new NotFoundError('Validation request not found');
    }

    const result = await submitVote(req.params.id, userId, req.body as SignedRecordEnvelope);
    if (!result.ok) {
      throwForVoteReason(result.reason);
    }

    res.status(201).json({
      recorded: true,
      requestId: req.params.id,
      verdict: result.verdict,
      status: result.status,
    });
  }),
);

/**
 * POST /civic/validations/:id/deny — recuse from a request (auth). The juror is
 * removed from the jury and the request is re-tallied.
 */
router.post(
  '/validations/:id/deny',
  authMiddleware,
  validationLimiter,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }
    if (!isValidObjectId(req.params.id)) {
      throw new NotFoundError('Validation request not found');
    }

    const result = await denyValidation(req.params.id, userId);
    if (!result.ok) {
      if (result.reason === 'request_not_found') {
        throw new NotFoundError('Validation request not found');
      }
      if (result.reason === 'not_selected') {
        throw new ForbiddenError('You are not on this validation jury');
      }
      throw new ConflictError(`Deny rejected: ${result.reason}`);
    }

    res.json({ denied: true });
  }),
);

export default router;
