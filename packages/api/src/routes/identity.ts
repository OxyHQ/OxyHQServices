/**
 * Identity Routes (self-sovereign identity layer — B5 signed records + B7 domains)
 *
 * Mounted at `/identity`:
 *  - `POST   /identity/records`                    (auth) publish a signed record
 *  - `GET    /identity/records/:userId/:type`      (public) latest record
 *  - `GET    /identity/records/:userId/:type/verify`(public) re-verify latest
 *  - `POST   /identity/domains`                    (auth) request a domain badge
 *  - `GET    /identity/domains`                    (auth) list verified + pending
 *  - `POST   /identity/domains/:domain/verify`     (auth) prove ownership
 *  - `DELETE /identity/domains/:domain`            (auth) remove a verified domain
 *
 * Domain verification proves ownership via a DNS-TXT record OR a `/.well-known`
 * file fetched through `safeFetch` (SSRF-safe — never a raw fetch of the
 * user-supplied domain).
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import dns from 'dns';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../utils/asyncHandler';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../utils/error';
import { validate } from '../middleware/validate';
import { isValidObjectId } from '../utils/validation';
import { rateLimit } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';
import { safeFetch } from '@oxyhq/core/server';
import {
  signedRecordEnvelopeSchema,
  domainVerificationRequestSchema,
  domainVerificationInstructionsSchema,
  type SignedRecordEnvelope,
  type ChainHeadResponse,
  type LogPageResponse,
} from '@oxyhq/contracts';
import { User } from '../models/User';
import type { VerifiedDomainMethod } from '../models/User';
import DomainVerification from '../models/DomainVerification';
import userCache from '../utils/userCache';
import {
  verifyAndStoreRecord,
  verifyEnvelope,
  getLatestRecord,
} from '../services/signedRecord.service';
import { getHead, getPublicLogSince, resolveCursorSeq } from '../services/repoLog.service';
import { materializeNodeFromRecord } from '../services/nodeRegistry.service';

const router = Router();

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

/** Per-authenticated-user rate-limit key (falls back to IP pre-auth). */
function userScopedKey(scope: string) {
  return (req: Request): string => {
    const userId = (req as AuthRequest).user?.id;
    return userId ? `${scope}:${userId}` : `${scope}:ip:${req.ip ?? 'unknown'}`;
  };
}

const domainRequestLimiter = rateLimit({
  prefix: 'rl:identity:domainreq:',
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many domain verification requests. Please try again later.',
  keyGenerator: userScopedKey('identity:domainreq'),
});

const domainVerifyLimiter = rateLimit({
  prefix: 'rl:identity:domainverify:',
  windowMs: 60 * 60 * 1000,
  max: 20,
  message: 'Too many domain verification attempts. Please try again later.',
  keyGenerator: userScopedKey('identity:domainverify'),
});

/**
 * Public node-log read limiters (F5a). Keyed by IP — these endpoints are public
 * (a node, or anyone, re-reads the user's authentic signed chain to re-verify it
 * independently). Generous, since this is Oxy→node export of already-public
 * signed records. Both are pure Oxy-DB reads — they NEVER touch a node.
 */
const nodeLogLimiter = rateLimit({
  prefix: 'rl:nodes:log:',
  windowMs: 60 * 1000,
  max: 60,
  message: 'Too many log requests. Please slow down.',
});

const nodeHeadLimiter = rateLimit({
  prefix: 'rl:nodes:head:',
  windowMs: 60 * 1000,
  max: 240,
  message: 'Too many head requests. Please slow down.',
});

const DNS_PREFIX = '_oxy-identity.';
const TXT_PREFIX = 'oxy-domain-verification=';
const WELL_KNOWN_PATH = '/.well-known/oxy-domain';
const MAX_WELL_KNOWN_BYTES = 1024;

// RFC 1035 hostname: 1+ dot-separated labels of letters/digits/hyphens (no
// leading/trailing hyphen), at least one dot, total length bounded.
const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

function normalizeDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase();
  if (domain.length === 0 || domain.length > 253) return null;
  if (!DOMAIN_PATTERN.test(domain)) return null;
  return domain;
}

/** Read up to `maxBytes` of a response stream as UTF-8, then stop. */
function readBoundedText(stream: NodeJS.ReadableStream, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total >= maxBytes) {
        chunks.push(chunk.subarray(0, chunk.length - (total - maxBytes)));
        (stream as { destroy?: () => void }).destroy?.();
        resolve(Buffer.concat(chunks).toString('utf8'));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

/** True when a DNS-TXT proof for `token` is published at `_oxy-identity.<domain>`. */
async function checkDnsProof(domain: string, token: string): Promise<boolean> {
  try {
    const records = await dns.promises.resolveTxt(`${DNS_PREFIX}${domain}`);
    const expected = `${TXT_PREFIX}${token}`;
    return records.some((chunks) => chunks.join('').trim() === expected);
  } catch (error) {
    // ENOTFOUND/ENODATA simply mean "no TXT record yet" — not a server error.
    logger.debug('DNS-TXT domain proof lookup found no match', {
      component: 'identity',
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/** True when a `/.well-known/oxy-domain` proof for `token` is served over HTTPS. */
async function checkWellKnownProof(domain: string, token: string): Promise<boolean> {
  try {
    const result = await safeFetch(`https://${domain}${WELL_KNOWN_PATH}`, {
      maxRedirects: 2,
      headersTimeoutMs: 5000,
    });
    if (result.status < 200 || result.status >= 300) {
      result.response.destroy();
      return false;
    }
    const body = await readBoundedText(result.response, MAX_WELL_KNOWN_BYTES);
    return body.trim() === token;
  } catch (error) {
    logger.debug('well-known domain proof fetch failed', {
      component: 'identity',
      domain,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/*  Signed records (B5)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * POST /identity/records — publish a client-signed record about the caller.
 * The envelope's `subject` MUST be the caller's DID and its `publicKey` MUST be
 * a current verification method; verification + storage is atomic.
 */
router.post(
  '/records',
  authMiddleware,
  validate({ body: signedRecordEnvelopeSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const envelope = req.body as SignedRecordEnvelope;
    const result = await verifyAndStoreRecord(envelope, userId);
    if (!result.ok) {
      throw new BadRequestError(`Signed record rejected: ${result.reason}`);
    }

    // F5a: a verified `node` record registers the user's personal data node.
    // Project it into the operational cache (upsert + fire a background liveness
    // probe). Best-effort and non-throwing — the signed record is already stored
    // on the chain; the request never awaits the node itself.
    if (envelope.type === 'node') {
      await materializeNodeFromRecord(userId, envelope.record);
    }

    res.status(201).json({
      envelope: result.record.envelope,
      verified: result.record.verified,
    });
  }),
);

/**
 * GET /identity/records/:userId/chain/head — the subject's hash-chain head
 * (public, cacheable, CORS-open). A client fetches this before signing the next
 * v2 record so it knows the `prev` (head `recordId`) and `seq` (`head.seq + 1`)
 * to sign over. Response shape (F0.2 contract — F1/client agents match this):
 *  - with a chain: `{ headRecordId: string, seq: number, recordCount: number }`
 *  - no chain yet: `{ headRecordId: null, seq: -1, recordCount: 0 }`
 *
 * Registered BEFORE `/:type` so the literal `chain/head` path is unambiguous.
 */
router.get(
  '/records/:userId/chain/head',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      throw new NotFoundError('Record not found');
    }

    const head = await getHead(userId);
    const payload: ChainHeadResponse = head
      ? { headRecordId: head.headRecordId, seq: head.seq, recordCount: head.recordCount }
      : { headRecordId: null, seq: -1, recordCount: 0 };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(payload);
  }),
);

/**
 * GET /identity/log/:userId?since=<seq|recordId>&limit= — the ordered slice of a
 * subject's public-safe verified signed-record chain (identity/profile/node
 * records only; the FULL envelopes, so a node or any verifier re-checks them
 * independently). This is the Oxy→node export of the public bootstrap chain.
 * Public, CORS-open, short-cached. A pure Oxy-DB read — it
 * touches ONLY Oxy's own copy of the chain, never a node. `since` is a chain
 * `seq` (exclusive) or the last-ingested `recordId`; absent → from genesis.
 */
router.get(
  '/log/:userId',
  nodeLogLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      throw new NotFoundError('User not found');
    }

    let sinceSeq = -1;
    const sinceRaw = typeof req.query.since === 'string' ? req.query.since.trim() : '';
    if (sinceRaw.length > 0) {
      if (/^\d+$/.test(sinceRaw)) {
        sinceSeq = Number.parseInt(sinceRaw, 10);
      } else {
        const resolved = await resolveCursorSeq(userId, sinceRaw);
        if (resolved === null) {
          throw new BadRequestError('Unknown `since` cursor');
        }
        sinceSeq = resolved;
      }
    }

    const limitRaw = typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : Number.NaN;
    const records = await getPublicLogSince(userId, sinceSeq, Number.isFinite(limitRaw) ? limitRaw : undefined);

    const page: LogPageResponse = { records, count: records.length };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(page);
  }),
);

/**
 * GET /identity/head/:userId — the subject's chain head from {@link RepoHead}
 * (O(1)): `{ seq, headRecordId, recordCount }`, or the empty form when the user
 * has no chain yet. Node-facing alias of the chain head; public, CORS-open,
 * short-cached, never touches a node.
 */
router.get(
  '/head/:userId',
  nodeHeadLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    if (!isValidObjectId(userId)) {
      throw new NotFoundError('User not found');
    }

    const head = await getHead(userId);
    const payload: ChainHeadResponse = head
      ? { headRecordId: head.headRecordId, seq: head.seq, recordCount: head.recordCount }
      : { headRecordId: null, seq: -1, recordCount: 0 };
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=5');
    res.json(payload);
  }),
);

/** GET /identity/records/:userId/:type — the latest published record (public). */
router.get(
  '/records/:userId/:type',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, type } = req.params;
    if (!isValidObjectId(userId)) {
      throw new NotFoundError('Record not found');
    }
    if (type !== 'identity' && type !== 'profile') {
      throw new BadRequestError('type must be "identity" or "profile"');
    }

    const record = await getLatestRecord(userId, type);
    if (!record) {
      throw new NotFoundError('Record not found');
    }

    res.json({ record: record.envelope });
  }),
);

/** GET /identity/records/:userId/:type/verify — re-verify the latest record (public). */
router.get(
  '/records/:userId/:type/verify',
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, type } = req.params;
    if (!isValidObjectId(userId)) {
      throw new NotFoundError('Record not found');
    }
    if (type !== 'identity' && type !== 'profile') {
      throw new BadRequestError('type must be "identity" or "profile"');
    }

    const record = await getLatestRecord(userId, type);
    if (!record) {
      throw new NotFoundError('Record not found');
    }

    const subjectUser = await User.findById(userId).select('publicKey authMethods').lean();
    if (!subjectUser) {
      throw new NotFoundError('Record not found');
    }

    const verification = await verifyEnvelope(record.envelope, userId);

    res.json({
      verified: verification.ok,
      ...(verification.ok ? {} : { reason: verification.reason }),
    });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Domain verification (B7)                                                  */
/* -------------------------------------------------------------------------- */

/** POST /identity/domains — request a verification token + instructions. */
router.post(
  '/domains',
  authMiddleware,
  domainRequestLimiter,
  validate({ body: domainVerificationRequestSchema }),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const domain = normalizeDomain(req.body.domain);
    if (!domain) {
      throw new BadRequestError('Invalid domain');
    }

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await DomainVerification.findOneAndUpdate(
      { userId, domain },
      { userId, domain, token, status: 'pending', expiresAt, $unset: { method: '' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    const instructions = domainVerificationInstructionsSchema.parse({
      domain,
      token,
      dns: { name: `${DNS_PREFIX}${domain}`, value: `${TXT_PREFIX}${token}` },
      wellKnown: { url: `https://${domain}${WELL_KNOWN_PATH}`, body: token },
    });

    res.status(201).json(instructions);
  }),
);

/** GET /identity/domains — the account's verified-domain badges. */
router.get(
  '/domains',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const user = await User.findById(userId).select('verifiedDomains').lean();
    const domains = (user?.verifiedDomains ?? []).map((entry) => ({
      domain: entry.domain,
      verifiedAt: entry.verifiedAt,
      method: entry.method,
    }));

    res.json({ domains });
  }),
);

/** POST /identity/domains/:domain/verify — prove ownership via DNS or well-known. */
router.post(
  '/domains/:domain/verify',
  authMiddleware,
  domainVerifyLimiter,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const domain = normalizeDomain(req.params.domain);
    if (!domain) {
      throw new BadRequestError('Invalid domain');
    }

    const pending = await DomainVerification.findOne({ userId, domain });
    if (!pending || pending.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestError('No active verification challenge for this domain. Request one first.');
    }

    let method: VerifiedDomainMethod | null = null;
    if (await checkDnsProof(domain, pending.token)) {
      method = 'dns-txt';
    } else if (await checkWellKnownProof(domain, pending.token)) {
      method = 'well-known';
    }

    if (!method) {
      throw new BadRequestError('Domain ownership could not be verified. Publish the DNS-TXT record or well-known file and try again.');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const verifiedAt = new Date();
    if (!user.verifiedDomains) {
      user.verifiedDomains = [];
    }
    const existing = user.verifiedDomains.find((entry) => entry.domain === domain);
    if (existing) {
      existing.verifiedAt = verifiedAt;
      existing.method = method;
    } else {
      user.verifiedDomains.push({ domain, verifiedAt, method });
    }

    await user.save();
    userCache.invalidate(userId);
    await DomainVerification.deleteOne({ _id: pending._id });

    res.json({ verified: true, domain: { domain, verifiedAt, method } });
  }),
);

/** DELETE /identity/domains/:domain — remove a verified-domain badge. */
router.delete(
  '/domains/:domain',
  authMiddleware,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const userId = req.user?._id?.toString();
    if (!userId) {
      throw new UnauthorizedError('Authentication required');
    }

    const domain = normalizeDomain(req.params.domain);
    if (!domain) {
      throw new BadRequestError('Invalid domain');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const before = user.verifiedDomains?.length ?? 0;
    user.verifiedDomains = (user.verifiedDomains ?? []).filter((entry) => entry.domain !== domain);
    if (user.verifiedDomains.length === before) {
      throw new NotFoundError('Domain is not verified for this account');
    }

    await user.save();
    userCache.invalidate(userId);
    await DomainVerification.deleteOne({ userId, domain });

    res.json({ success: true });
  }),
);

export default router;
