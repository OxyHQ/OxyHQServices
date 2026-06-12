import { Request, Response } from 'express';
import fedcmService from '../services/fedcm.service';
import { logger } from '../utils/logger';
import { AuthRequest } from '../middleware/auth';
import { issueAndSetRefreshCookie } from '../services/refreshToken.service';

/**
 * Mint a single-use server-side nonce for the FedCM handoff. The auth UI
 * embeds the returned nonce in `navigator.credentials.get({ identity: {
 * nonce } })`; the consuming app then exchanges the resulting ID token via
 * `POST /fedcm/exchange`, which validates and burns the nonce server-side.
 *
 * The nonce is bound to the requesting `Origin` header so a nonce minted
 * for one site cannot be replayed from another.
 */
export async function mintNonce(req: Request, res: Response) {
  try {
    const origin = req.headers.origin;
    if (typeof origin !== 'string' || origin.length === 0) {
      return res.status(400).json({ message: 'Origin header is required' });
    }
    const result = await fedcmService.mintNonce(origin);
    return res.json(result);
  } catch (error) {
    logger.error('FedCM mint nonce error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Exchange FedCM ID token for an Oxy session
 *
 * This endpoint enables cross-domain SSO without cookies:
 * - Client receives ID token from FedCM (browser-native identity API)
 * - Client exchanges token here for a full Oxy session with access token
 * - Works across any domain (alia.onl, mention.earth, homiio.com, etc.)
 */
export async function exchangeIdToken(req: Request, res: Response) {
  try {
    const { id_token } = req.body;

    if (!id_token) {
      return res.status(400).json({
        message: 'id_token is required',
      });
    }

    const result = await fedcmService.exchangeIdToken(id_token, req);

    if ('error' in result) {
      return res.status(401).json({
        message: 'Invalid or expired ID token',
        reason: result.error,
      });
    }

    // Plant the first-party httpOnly refresh cookie for cold-boot session
    // persistence. `result.user.id` is a string ObjectId; issueRefreshToken
    // accepts string | ObjectId. A failure here must never break the exchange.
    // `cookieHeader` is forwarded so the helper resolves the device-local
    // `authuser` slot (Google-style multi-account: append to existing accounts,
    // reuse an existing slot for this user, or evict the LRU at the device cap).
    let fedcmAuthuser: number | null = null;
    try {
      const issued = await issueAndSetRefreshCookie(res, result.sessionId, result.user.id, {
        cookieHeader: req.headers.cookie,
      });
      fedcmAuthuser = issued.authuser;
    } catch (error) {
      logger.error('Failed to set refresh cookie during FedCM exchange', error instanceof Error ? error : new Error(String(error)), {
        component: 'FedCMController',
        method: 'exchangeIdToken',
        sessionId: result.sessionId,
      });
    }

    const responseWithAuthuser: typeof result & { authuser?: number } =
      fedcmAuthuser === null ? result : { ...result, authuser: fedcmAuthuser };
    return res.json(responseWithAuthuser);
  } catch (error) {
    logger.error('FedCM token exchange error:', error);
    return res.status(500).json({
      message: 'Internal server error',
    });
  }
}

/**
 * Get the RP origins a user has previously granted via FedCM.
 *
 * Consumed by the IdP accounts endpoint (auth.oxy.so) to populate the FedCM
 * `approved_clients` array, which lets Chrome treat the account as a returning
 * account for those RPs (skips disclosure UI, enables silent mediation).
 *
 * Returns only public app origins the user themselves authorized — the same
 * data surface as the public `GET /fedcm/clients/approved`, filtered to this
 * user — so it carries no token material or PII and is safe to expose to the
 * IdP server-to-server fetch without a bearer token. The result is also
 * intersected with the currently-approved client list, so a removed origin can
 * never leak back.
 */
export async function getUserGrants(req: Request, res: Response) {
  try {
    const { userId } = req.params;

    if (!userId || !/^[a-f0-9]{24}$/i.test(userId)) {
      return res.status(400).json({ message: 'A valid userId is required' });
    }

    const origins = await fedcmService.getUserGrantedOrigins(userId);

    return res.json({ origins });
  } catch (error) {
    logger.error('Get FedCM user grants error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Get approved FedCM client origins
 */
export async function getApprovedClients(req: Request, res: Response) {
  try {
    const origins = await fedcmService.getApprovedClientOrigins();

    return res.json({
      success: true,
      clients: origins,
    });
  } catch (error) {
    logger.error('Get approved FedCM clients error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Add a new approved client (internal service only)
 */
export async function addApprovedClient(req: AuthRequest, res: Response) {
  try {
    const { origin, name, description } = req.body;
    const userId = req.user?.id;

    if (!origin || !name) {
      return res.status(400).json({ message: 'Origin and name are required' });
    }

    // Validate origin format (allow HTTP, HTTPS, and approved native app schemes)
    try {
      const url = new URL(origin);
      const allowedProtocols = ['http:', 'https:', 'astro:'];
      if (!allowedProtocols.includes(url.protocol)) {
        return res.status(400).json({ message: 'Origin must use HTTP, HTTPS, or an approved native app protocol' });
      }
    } catch {
      return res.status(400).json({ message: 'Invalid origin URL' });
    }

    const client = await fedcmService.addApprovedClient(
      origin,
      name,
      description,
      userId
    );

    return res.json({
      success: true,
      message: 'Client added successfully',
      client: {
        origin: client.origin,
        name: client.name,
        description: client.description,
      },
    });
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code: number }).code === 11000) {
      return res.status(409).json({ message: 'Client origin already exists' });
    }

    logger.error('Add approved FedCM client error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Remove an approved client (internal service only)
 */
export async function removeApprovedClient(req: Request, res: Response) {
  try {
    const { origin } = req.params;

    if (!origin) {
      return res.status(400).json({ message: 'Origin is required' });
    }

    const removed = await fedcmService.removeApprovedClient(origin);

    if (!removed) {
      return res.status(404).json({ message: 'Client not found' });
    }

    return res.json({
      success: true,
      message: 'Client removed successfully',
    });
  } catch (error) {
    logger.error('Remove approved FedCM client error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * List the authenticated user's authorized RP apps in full detail.
 *
 * Powers the "Connected apps" management UI in @oxyhq/services. Returns the
 * intersection of the user's FedCM grants with the currently-approved client
 * catalog, so a de-approved origin can never leak back. Requires a real user
 * session — not exposed to anonymous callers.
 */
export async function listMyAuthorizedApps(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const apps = await fedcmService.getUserAuthorizedApps(userId);
    return res.json({ apps });
  } catch (error) {
    logger.error('List authorized apps error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

/**
 * Revoke the authenticated user's authorization for a specific RP origin.
 *
 * Removes the underlying `FedCMGrant` so the origin no longer appears in
 * `approved_clients` — the next FedCM sign-in from that origin will require
 * explicit re-consent. 404 if no grant existed (idempotent from the client's
 * perspective).
 */
export async function revokeMyAuthorizedApp(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const { origin } = req.params;
    if (typeof origin !== 'string' || origin.length === 0) {
      return res.status(400).json({ message: 'Origin is required' });
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(origin);
    } catch {
      return res.status(400).json({ message: 'Invalid origin encoding' });
    }
    try {
      const removed = await fedcmService.revokeUserGrant(userId, decoded);
      if (!removed) {
        return res.status(404).json({ message: 'No authorization found for this app' });
      }
      return res.json({ success: true, message: 'Authorization revoked' });
    } catch (innerError) {
      if (innerError instanceof TypeError) {
        return res.status(400).json({ message: 'Invalid origin URL' });
      }
      throw innerError;
    }
  } catch (error) {
    logger.error('Revoke authorized app error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
