/**
 * Civic / Commons Routes (Fase 1 — public DNI card)
 *
 * Mounted at `/civic` (beside `/identity`):
 *  - `GET /civic/:userId/card` — the user's signed, verifiable "DNI" card.
 *
 * Public, cacheable, CORS-open (`Access-Control-Allow-Origin: *`), no auth, no
 * CSRF — a public card is meant to be scanned by anyone. The response is the
 * `{ card, attestation }` envelope (`signedPublicCardSchema`); a scanner verifies
 * the Oxy attestation OFFLINE. More civic routes (attestations, validations,
 * personhood) arrive in Fase 2/3.
 */

import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError } from '../utils/error';
import { isValidObjectId } from '../utils/validation';
import { buildSignedPublicCard } from '../services/civic/publicCard.service';

const router = Router();

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

export default router;
