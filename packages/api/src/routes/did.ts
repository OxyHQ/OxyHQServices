/**
 * DID Document Routes (self-sovereign identity layer — B2)
 *
 * Serves the W3C `did:web` documents that make an Oxy account resolvable by any
 * standard DID resolver:
 *  - `GET /.well-known/did.json` — the Oxy organisation DID (`did:web:<domain>`)
 *  - `GET /u/:userId/did.json`   — a user DID (`did:web:<domain>:u:<userId>`)
 *
 * Public, cacheable, CORS-open (`Access-Control-Allow-Origin: *`), no auth, no
 * CSRF — a DID document is public infrastructure. Mounted at the API root in
 * `server.ts` beside the WebFinger/ActivityPub handlers, OUTSIDE the `/users`
 * rate-limit/CSRF group.
 *
 * Resolution note: `did:web:oxy.so` resolves to `https://oxy.so/u/<id>/did.json`,
 * so the apex proxy must forward the user-DID and well-known-DID paths to this
 * API exactly as it already forwards the well-known and ActivityPub prefixes.
 */

import { Router, Request, Response } from 'express';
import { User } from '../models/User';
import { isValidObjectId } from '../utils/validation';
import { buildDidDocument, buildOxyDidDocument } from '../services/did.service';
import { logger } from '../utils/logger';

const router = Router();

/** Headers shared by every DID document response. */
function setDidHeaders(res: Response): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
}

// Oxy organisation DID document.
router.get('/.well-known/did.json', (_req: Request, res: Response) => {
  setDidHeaders(res);
  return res.json(buildOxyDidDocument());
});

// Per-user DID document.
router.get('/u/:userId/did.json', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'DID not found' });
    }

    const user = await User.findById(userId)
      .select('publicKey username authMethods verifiedDomains type federation')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'NOT_FOUND', message: 'DID not found' });
    }

    const document = buildDidDocument({
      _id: user._id,
      publicKey: user.publicKey,
      username: user.username,
      authMethods: user.authMethods,
      verifiedDomains: user.verifiedDomains,
      type: user.type,
      federation: user.federation,
    });

    setDidHeaders(res);
    return res.json(document);
  } catch (err) {
    logger.error(
      'DID document build failed',
      err instanceof Error ? err : new Error(String(err)),
      { component: 'did', method: 'GET /u/:userId/did.json' },
    );
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR', message: 'Failed to build DID document' });
  }
});

export default router;
