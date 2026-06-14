import FedCMClient from '../models/FedCMClient';
import FedCMNonce from '../models/FedCMNonce';
import FedCMGrant from '../models/FedCMGrant';
import { User } from '../models/User';
import { logger } from '../utils/logger';
import { normaliseOrigin } from '../utils/origin';
import approvedClientsCache from '../utils/approvedClientsCache';
import sessionService from './session.service';
import { Request } from 'express';
import * as crypto from 'crypto';

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const NONCE_BYTES = 32;

/** SHA-256 hex digest helper — never persist or compare raw nonces. */
function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Constant-time string equality (length-tolerant). */
function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

/**
 * Local wrapper that preserves the previous throw-on-invalid contract of this
 * service's call sites. The shared `normaliseOrigin` helper fails closed
 * (returns `null`); several FedCM call sites historically relied on a throw
 * (either propagated to the caller or caught and turned into a validation
 * error), so this re-throws to keep that observable behaviour identical.
 */
function normaliseOriginOrThrow(value: string): string {
  const normalised = normaliseOrigin(value);
  if (normalised === null) {
    throw new TypeError(`Invalid URL: ${value}`);
  }
  return normalised;
}

// FedCM ID token issuer - must match auth server's NEXT_PUBLIC_OXY_AUTH_URL
const FEDCM_ISSUER = (process.env.FEDCM_ISSUER || 'https://auth.oxy.so').replace(/\/+$/, '');

// Shared secret for verifying FedCM tokens - must match auth.oxy.so
// Validated lazily on first use so the module can be imported without crashing
// when the env var is missing (startup validation in env.ts catches it separately).
function getFedCMTokenSecret(): string {
  const secret = process.env.FEDCM_TOKEN_SECRET;
  if (!secret) {
    throw new Error('FEDCM_TOKEN_SECRET is required but not configured');
  }
  return secret;
}

/**
 * Public-facing summary of a user's authorized RP application — what the
 * "Connected apps" management UI in @oxyhq/services consumes. Built by
 * `getUserAuthorizedApps` from FedCMGrant rows joined with FedCMClient.
 */
export interface AuthorizedAppSummary {
  /** Normalised RP origin (== FedCM client_id == token aud). */
  origin: string;
  /** Friendly display name from the approved-clients catalog. */
  name: string;
  /** Optional description from the approved-clients catalog. */
  description?: string;
  /** ISO-8601 timestamp of when the user first authorized this RP. */
  firstGrantedAt: string;
  /** ISO-8601 timestamp of the most recent FedCM exchange for this user+RP. */
  lastUsedAt: string;
}

interface FedCMTokenPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  nonce?: string;
}

/**
 * Verify and decode FedCM ID token (JWT with HS256)
 * @throws Error if token is invalid or signature doesn't match
 */
function verifyIdToken(token: string): FedCMTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid token format: expected 3 parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const signatureInput = `${headerB64}.${payloadB64}`;
  const expectedSignature = crypto
    .createHmac('sha256', getFedCMTokenSecret())
    .update(signatureInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Use timing-safe comparison to prevent timing attacks
  const sigBuf = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('Invalid token signature');
  }

  // Decode header and verify algorithm
  const header = JSON.parse(
    Buffer.from(headerB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  );
  if (header.alg !== 'HS256') {
    throw new Error(`Unsupported algorithm: ${header.alg}`);
  }

  // Decode and return payload
  const payload = JSON.parse(
    Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8')
  );

  return payload as FedCMTokenPayload;
}

/**
 * FedCM Service
 * Manages Federated Credential Management approved clients and token exchange
 */
class FedCMService {
  /**
   * Uncached read of all approved client origins straight from Mongo.
   * Fail-soft: returns `[]` on error so callers (and the cache loader) never
   * throw on a transient DB hiccup.
   */
  private async fetchApprovedClientOrigins(): Promise<string[]> {
    try {
      const clients = await FedCMClient.find({ approved: true })
        .select('origin')
        .lean();

      return clients.map(client => client.origin);
    } catch (error) {
      logger.error('Error fetching approved FedCM clients:', error);
      return [];
    }
  }

  /**
   * Get all approved client origins (short-TTL cached — see approvedClientsCache).
   */
  async getApprovedClientOrigins(): Promise<string[]> {
    return approvedClientsCache.getApprovedOrigins(() => this.fetchApprovedClientOrigins());
  }

  /**
   * Check if a client origin is approved (short-TTL cached membership test).
   * Fail-closed: any unexpected throw resolves to `false`, and the cache loader
   * itself returns `[]` on Mongo error so a DB hiccup denies rather than admits.
   */
  async isClientApproved(origin: string): Promise<boolean> {
    try {
      return await approvedClientsCache.isApproved(origin, () => this.fetchApprovedClientOrigins());
    } catch (error) {
      logger.error('Error checking FedCM client approval:', error);
      return false;
    }
  }

  /**
   * Seed initial approved clients (run once during setup)
   */
  async seedApprovedClients(): Promise<void> {
    try {
      const defaultClients = [
        {
          origin: 'https://oxy.so',
          name: 'Oxy',
          description: 'Oxy main platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://accounts.oxy.so',
          name: 'Oxy Accounts',
          description: 'Oxy accounts portal',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://homiio.com',
          name: 'Homiio',
          description: 'Homiio social platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://mention.earth',
          name: 'Mention Earth',
          description: 'Mention Earth platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'https://alia.onl',
          name: 'Alia',
          description: 'Alia platform',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'http://localhost:3000',
          name: 'Local Development (3000)',
          description: 'Development environment',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'http://localhost:8081',
          name: 'Local Development (8081)',
          description: 'Expo development environment',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
        {
          origin: 'astro://auth',
          name: 'Astro Browser',
          description: 'Astro browser native auth callback',
          approved: true,
          autoSignIn: true,
          approvedAt: new Date(),
        },
      ];

      for (const clientData of defaultClients) {
        await FedCMClient.findOneAndUpdate(
          { origin: clientData.origin },
          { $setOnInsert: clientData },
          { upsert: true, new: true }
        );
      }

      logger.info(`Seeded ${defaultClients.length} FedCM approved clients`);
      // Drop any list cached before/during seeding so the first read after
      // boot reflects the freshly-seeded allow-list.
      approvedClientsCache.invalidate();
    } catch (error) {
      logger.error('Error seeding FedCM clients:', error);
      throw error;
    }
  }

  /**
   * Add a new approved client
   */
  async addApprovedClient(
    origin: string,
    name: string,
    description?: string,
    approvedBy?: string
  ): Promise<typeof FedCMClient.prototype> {
    const client = await FedCMClient.create({
      origin,
      name,
      description,
      approved: true,
      autoSignIn: true,
      approvedAt: new Date(),
      approvedBy,
    });

    logger.info(`Added new FedCM approved client: ${origin}`);
    approvedClientsCache.invalidate();
    return client;
  }

  /**
   * Remove approved client
   */
  async removeApprovedClient(origin: string): Promise<boolean> {
    const result = await FedCMClient.deleteOne({ origin });
    approvedClientsCache.invalidate();
    return result.deletedCount > 0;
  }

  /**
   * Record (or refresh) a user's FedCM grant for an RP origin.
   *
   * Called after a successful `/fedcm/exchange` — at that point the user has
   * actively completed a FedCM sign-in for `clientOrigin`, which is exactly
   * the consent the spec's `approved_clients` array represents. Upserts on the
   * unique `{ userId, clientOrigin }` index so repeat sign-ins refresh
   * `lastUsedAt` instead of inserting duplicates.
   *
   * Best-effort: a failure here must never block the session that was just
   * minted, so we swallow and log. The worst case is a returning user briefly
   * sees the disclosure UI again on their next cross-app visit.
   */
  async recordGrant(userId: string, clientOrigin: string): Promise<void> {
    try {
      const normalisedOrigin = normaliseOriginOrThrow(clientOrigin);
      const now = new Date();
      await FedCMGrant.findOneAndUpdate(
        { userId, clientOrigin: normalisedOrigin },
        {
          $set: { lastUsedAt: now },
          $setOnInsert: { userId, clientOrigin: normalisedOrigin, firstGrantedAt: now },
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      logger.error('Error recording FedCM grant:', error);
    }
  }

  /**
   * List the RP origins a user has previously granted via FedCM.
   *
   * Powers the `approved_clients` array on the IdP accounts endpoint. We
   * intersect the user's grants with the *currently approved* client list so a
   * de-approved (removed) origin never leaks back as an approved client.
   */
  async getUserGrantedOrigins(userId: string): Promise<string[]> {
    try {
      const [grants, approvedOrigins] = await Promise.all([
        FedCMGrant.find({ userId }).select('clientOrigin').lean(),
        this.getApprovedClientOrigins(),
      ]);

      const approvedSet = new Set(
        approvedOrigins.map((origin) => {
          try {
            return normaliseOriginOrThrow(origin);
          } catch {
            return origin;
          }
        })
      );

      const granted = new Set<string>();
      for (const grant of grants) {
        if (approvedSet.has(grant.clientOrigin)) {
          granted.add(grant.clientOrigin);
        }
      }
      return Array.from(granted);
    } catch (error) {
      logger.error('Error fetching FedCM grants:', error);
      return [];
    }
  }

  /**
   * List a user's authorized apps in full detail — origin, friendly name,
   * description, first-granted/last-used timestamps. Intersected with the
   * currently-approved FedCM clients so a de-approved origin never leaks back.
   *
   * Powers the "Connected apps" management UI in @oxyhq/services.
   */
  async getUserAuthorizedApps(userId: string): Promise<AuthorizedAppSummary[]> {
    try {
      const [grants, approvedClients] = await Promise.all([
        FedCMGrant.find({ userId })
          .select('clientOrigin firstGrantedAt lastUsedAt')
          .sort({ lastUsedAt: -1 })
          .lean(),
        // Intentionally NOT routed through approvedClientsCache: this is the
        // Connected-apps UI which needs the richer { origin, name, description }
        // projection, not just the origin list the cache stores.
        FedCMClient.find({ approved: true })
          .select('origin name description')
          .lean(),
      ]);

      const approvedMap = new Map<string, { name: string; description?: string }>();
      for (const client of approvedClients) {
        let key = client.origin;
        try {
          key = normaliseOriginOrThrow(client.origin);
        } catch {
          // Keep raw origin if normalisation fails (defensive — should not happen)
        }
        approvedMap.set(key, { name: client.name, description: client.description });
      }

      const apps: AuthorizedAppSummary[] = [];
      for (const grant of grants) {
        const meta = approvedMap.get(grant.clientOrigin);
        if (!meta) continue;
        apps.push({
          origin: grant.clientOrigin,
          name: meta.name,
          description: meta.description,
          firstGrantedAt: grant.firstGrantedAt.toISOString(),
          lastUsedAt: grant.lastUsedAt.toISOString(),
        });
      }
      return apps;
    } catch (error) {
      logger.error('Error fetching authorized apps for user:', error);
      return [];
    }
  }

  /**
   * Revoke a user's authorization for a specific RP origin. Removes the
   * `FedCMGrant` row so the origin no longer appears in `approved_clients` —
   * the next FedCM sign-in from that origin will require explicit re-consent.
   *
   * @returns `true` if a grant was removed, `false` if no matching grant existed
   */
  async revokeUserGrant(userId: string, clientOrigin: string): Promise<boolean> {
    try {
      const normalised = normaliseOriginOrThrow(clientOrigin);
      const result = await FedCMGrant.deleteOne({ userId, clientOrigin: normalised });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error('Error revoking FedCM grant:', error);
      throw error;
    }
  }

  /**
   * Mint a single-use nonce that the auth UI embeds in the FedCM
   * `navigator.credentials.get({ identity: { nonce } })` call. The IdP
   * signs the nonce into the ID token; we burn the nonce on the first
   * successful token exchange. Bound to the requesting origin so a
   * nonce minted for origin A can't be used by origin B.
   */
  async mintNonce(origin: string): Promise<{ nonce: string; expiresAt: string }> {
    const normalisedOrigin = normaliseOriginOrThrow(origin);
    const raw = crypto.randomBytes(NONCE_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + NONCE_TTL_MS);
    await FedCMNonce.create({
      nonceHash: sha256Hex(raw),
      origin: normalisedOrigin,
      expiresAt,
    });
    return { nonce: raw, expiresAt: expiresAt.toISOString() };
  }

  /**
   * Exchange FedCM ID token for a session.
   *
   * Hardened to reject (H9):
   *  - any token whose `aud` is not an approved client origin (previously
   *    we only logged a warning and continued);
   *  - any token whose `nonce` is missing, unknown, or already used;
   *  - any request whose HTTP `Origin` header doesn't match the token's
   *    `aud` (protects against a malicious page reusing a leaked token).
   *
   * @param idToken - The FedCM ID token (JWT from auth.oxy.so)
   * @param req - Express request for device info and Origin checks
   * @returns Session with access token, or `{ error: string }` on failure.
   */
  async exchangeIdToken(
    idToken: string,
    req: Request
  ): Promise<{
    sessionId: string;
    deviceId: string;
    expiresAt: string;
    accessToken: string;
    user: { id: string; username?: string; email?: string; avatar?: string; name?: string };
    error?: never;
  } | { error: string }> {
    logger.info('FedCM: exchangeIdToken called');

    try {
      // Verify and decode the ID token (includes signature verification)
      let tokenPayload: FedCMTokenPayload;
      try {
        tokenPayload = verifyIdToken(idToken);
        logger.debug('FedCM: Token verified successfully');
      } catch (error) {
        logger.warn('FedCM: Token verification failed', { reason: error instanceof Error ? error.message : String(error) });
        return { error: 'token_verification_failed' };
      }

      // Validate required fields. We also require `nonce` to enforce the
      // anti-replay binding established at `POST /fedcm/nonce`.
      if (!tokenPayload.sub || !tokenPayload.aud || !tokenPayload.nonce) {
        logger.warn('FedCM: Invalid token payload - missing sub, aud, or nonce');
        return { error: 'missing_required_fields' };
      }

      // Verify issuer (normalize trailing slashes for comparison)
      if (tokenPayload.iss?.replace(/\/+$/, '') !== FEDCM_ISSUER) {
        logger.warn('FedCM: Invalid issuer', { expected: FEDCM_ISSUER, got: tokenPayload.iss });
        return { error: 'invalid_issuer' };
      }

      // Check expiration
      if (tokenPayload.exp && tokenPayload.exp < Math.floor(Date.now() / 1000)) {
        logger.warn('FedCM: Token expired');
        return { error: 'token_expired' };
      }

      // Audience check — must be on the approved client allowlist. This
      // previously only logged a warning and continued processing, which
      // allowed a malicious origin to mint sessions from any user's
      // leaked token (H9).
      let clientOrigin: string;
      try {
        clientOrigin = normaliseOriginOrThrow(tokenPayload.aud);
      } catch {
        logger.warn('FedCM: Token aud is not a valid origin', { aud: tokenPayload.aud });
        return { error: 'invalid_audience' };
      }
      const isApproved = await this.isClientApproved(clientOrigin);
      if (!isApproved) {
        logger.warn('FedCM: Client origin not in approved list', { clientOrigin });
        return { error: 'audience_not_approved' };
      }

      // Origin check — the actual HTTP Origin header must match the
      // token aud. Without this a malicious page could replay a token
      // issued for a different origin.
      const requestOriginRaw = req.headers.origin;
      if (typeof requestOriginRaw === 'string' && requestOriginRaw.length > 0) {
        let requestOrigin: string;
        try {
          requestOrigin = normaliseOriginOrThrow(requestOriginRaw);
        } catch {
          logger.warn('FedCM: Request Origin header is not a valid origin', { origin: requestOriginRaw });
          return { error: 'invalid_request_origin' };
        }
        if (!timingSafeStringEqual(clientOrigin, requestOrigin)) {
          logger.warn('FedCM: Origin header does not match token aud', { clientOrigin, requestOrigin });
          return { error: 'origin_aud_mismatch' };
        }
      } else {
        // A FedCM exchange MUST be a CORS request initiated by a browser;
        // a missing Origin header indicates a non-browser caller. Treat as
        // hostile per the principle of lock-down-by-default.
        logger.warn('FedCM: Missing Origin header on token exchange');
        return { error: 'missing_origin' };
      }

      // Nonce check — single-use, bound to the token aud, must exist.
      // Atomic findOneAndUpdate so two concurrent exchanges can't both
      // succeed: only the first wins the {usedAt: null} -> set transition.
      const nonceHash = sha256Hex(tokenPayload.nonce);
      const nonceClaim = await FedCMNonce.findOneAndUpdate(
        { nonceHash, usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true }
      );
      if (!nonceClaim) {
        logger.warn('FedCM: Nonce missing, expired, or already used', { nonceHash });
        return { error: 'invalid_nonce' };
      }
      if (!timingSafeStringEqual(nonceClaim.origin, clientOrigin)) {
        logger.warn('FedCM: Nonce origin does not match token aud', {
          nonceOrigin: nonceClaim.origin,
          clientOrigin,
        });
        return { error: 'nonce_origin_mismatch' };
      }

      // Get user by ID (with virtuals to get name.full)
      const userId = tokenPayload.sub;
      const user = await User.findById(userId).select('-password').lean({ virtuals: true });

      if (!user) {
        logger.warn('FedCM: User not found for token exchange', { userId });
        return { error: 'user_not_found' };
      }

      // Create (or reuse) a session for this user. `req` here is the IdP
      // Cloudflare Worker's server-to-server request (UA = 'unknown', egress
      // IP varies per call), so we pass a `stableDeviceKey` of the RP origin:
      // the deviceId is derived deterministically from (userId, clientOrigin)
      // so a given (user, RP) reuses ONE session that just refreshes its
      // tokens/expiry on each silent-auth / SSO bounce — instead of minting a
      // brand-new "FedCM Sign-In" session every exchange.
      const session = await sessionService.createSession(userId, req, {
        deviceName: 'FedCM Sign-In',
        stableDeviceKey: clientOrigin,
      });

      // Record the grant: the user just actively authorized this RP origin via
      // FedCM, so it belongs in `approved_clients` for future returning-account
      // / silent-SSO flows. Best-effort — never blocks the issued session.
      await this.recordGrant(userId, clientOrigin);

      logger.info('FedCM: Session created via token exchange', { clientOrigin });

      const userDoc = user as { _id?: { toString(): string }; id?: string; username?: string; email?: string; avatar?: string; name?: { full?: string } | string };
      const idValue = userDoc._id?.toString() ?? userDoc.id ?? '';
      const nameValue = typeof userDoc.name === 'string'
        ? userDoc.name
        : userDoc.name?.full;
      return {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        expiresAt: session.expiresAt.toISOString(),
        accessToken: session.accessToken,
        user: {
          id: idValue,
          username: userDoc.username,
          email: userDoc.email,
          avatar: userDoc.avatar,
          name: nameValue,
        },
      };
    } catch (error) {
      logger.error('FedCM: Token exchange failed', error);
      return { error: 'internal_error' };
    }
  }
}

export default new FedCMService();
