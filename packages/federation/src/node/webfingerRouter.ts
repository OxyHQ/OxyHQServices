/**
 * The WebFinger + host-meta discovery router.
 *
 * `/.well-known/webfinger` resolves `acct:<user>@<domain>` to the local actor URL;
 * `/.well-known/host-meta(.json)` advertises the WebFinger LRDD template. Both are
 * domain-parameterized (each app answers for its OWN `domain`) and both enforce
 * the fediverse-sharing consent gate — a disabled/unknown user 404s
 * indistinguishably. The JRD cache (Mention: Redis) is injected so the caching
 * strategy stays app-side; the response bytes + the 404-when-off semantics live
 * here so every Oxy app discovers identically.
 *
 * Extracted behaviour-identically from Mention's `wellKnown.routes.ts`.
 */

import { Router, type Request, type Response } from 'express';
import type { UrlBuilders } from '../urls';

/** 1 hour, in seconds — the WebFinger JRD cache TTL + response `max-age`. */
const WEBFINGER_CACHE_TTL = 3600;
/** 24h — host-meta is effectively static. */
const HOST_META_CACHE_CONTROL = `max-age=${60 * 60 * 24}`;

/** The tri-state consent read for a username with no already-resolved user object. */
export type WebfingerSharingState = 'enabled' | 'disabled' | 'unknown-user' | 'unavailable';

/** The resolved-user fields the webfinger consent fallback reads. */
export interface WebfingerUser {
  _id?: string | null;
  id?: string | null;
}

/** A cached WebFinger JRD document (the `subject` + `links` shape served below). */
export interface WebfingerJrd {
  subject: string;
  links: Array<{ rel: string; type?: string; href: string }>;
}

/** Minimal logging sink the webfinger router writes to. */
export interface WebfingerLogger {
  error(message: string, detail?: unknown): void;
}

/** Adapters + config a {@link createWebfingerRouter} is built from. */
export interface WebfingerRouterConfig {
  /** The app's federation domain (the only `acct:` domain this instance answers for). */
  domain: string;
  /** Whether federation is enabled (all routes 404 when off). */
  federationEnabled: boolean;
  /** Per-instance URL builders (the actor `self` link). */
  urls: UrlBuilders;
  /** Resolve a username to its Oxy user (null when unknown). */
  resolveUser(username: string): Promise<WebfingerUser | null>;
  /** The fediverse-sharing consent gate. */
  consent: {
    /** Sync read off an already-resolved user (the `'unavailable'` fallback). */
    isSharingEnabledFromUser(user: WebfingerUser): boolean;
    /** Fresh, uncached tri-state read by username. */
    getSharingStateByUsername(username: string): Promise<WebfingerSharingState>;
  };
  /** JRD response cache (Mention: Redis). Reads/writes are best-effort. */
  cache: {
    get(username: string): Promise<WebfingerJrd | null>;
    set(username: string, jrd: WebfingerJrd): void;
  };
  /** Diagnostics sink. */
  logger: WebfingerLogger;
}

/** Build the WebFinger + host-meta discovery router for an app's domain. */
export function createWebfingerRouter(config: WebfingerRouterConfig): Router {
  const router = Router();
  const { domain } = config;
  const webfingerTemplate = `https://${domain}/.well-known/webfinger?resource={uri}`;

  router.get('/webfinger', async (req: Request, res: Response) => {
    if (!config.federationEnabled) {
      return res.status(404).json({ error: 'Federation is disabled' });
    }

    const resource = typeof req.query.resource === 'string' ? req.query.resource : undefined;
    if (!resource || !resource.startsWith('acct:')) {
      return res.status(400).json({ error: 'Resource must start with acct:' });
    }

    const acct = resource.replace('acct:', '');
    const atIndex = acct.indexOf('@');
    if (atIndex === -1) {
      return res.status(400).json({ error: 'Invalid acct format' });
    }

    const username = acct.substring(0, atIndex);
    const acctDomain = acct.substring(atIndex + 1);

    if (acctDomain.toLowerCase() !== domain.toLowerCase()) {
      return res.status(404).json({ error: 'Unknown domain' });
    }

    try {
      // Check the JRD cache first.
      const cached = await config.cache.get(username);
      if (cached) {
        res.set('Content-Type', 'application/jrd+json; charset=utf-8');
        res.set('Cache-Control', `max-age=${WEBFINGER_CACHE_TTL}`);
        return res.json(cached);
      }

      const user = await config.resolveUser(username);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Sharing OFF must be indistinguishable from a nonexistent user — same 404
      // body, no separate error code. UNLIKE the other user-scoped surfaces,
      // webfinger does a SECOND, uncached consent read here rather than reusing
      // the already-resolved `user`: this response is ALSO cached for a full hour
      // below, so a stale-DTO false positive would lock the actor (un)discoverable
      // for up to an hour. An Oxy OUTAGE ('unavailable') on that fresh read falls
      // back to the already-resolved `user` instead of 404ing, so a transient
      // hiccup never makes a real account momentarily undiscoverable.
      const sharingState = await config.consent.getSharingStateByUsername(username);
      if (sharingState === 'disabled' || sharingState === 'unknown-user') {
        return res.status(404).json({ error: 'User not found' });
      }
      if (sharingState === 'unavailable' && !config.consent.isSharingEnabledFromUser(user)) {
        return res.status(404).json({ error: 'User not found' });
      }

      const response: WebfingerJrd = {
        subject: `acct:${username}@${domain}`,
        links: [
          {
            rel: 'self',
            type: 'application/activity+json',
            href: config.urls.actor(username),
          },
          {
            rel: 'http://webfinger.net/rel/profile-page',
            type: 'text/html',
            href: `https://${domain}/@${username}`,
          },
          // NOTE: the `http://ostatus.org/schema/1.0/subscribe` (remote-follow) rel
          // is intentionally omitted — there is no authorize-interaction endpoint
          // to point it at, and a dangling template would be worse than its absence.
        ],
      };

      config.cache.set(username, response);

      res.set('Content-Type', 'application/jrd+json; charset=utf-8');
      res.set('Cache-Control', `max-age=${WEBFINGER_CACHE_TTL}`);
      return res.json(response);
    } catch (err) {
      config.logger.error('WebFinger error:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/host-meta', (_req: Request, res: Response) => {
    if (!config.federationEnabled) {
      return res.status(404).json({ error: 'Federation is disabled' });
    }
    const xrd = `<?xml version="1.0" encoding="UTF-8"?>
<XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0">
  <Link rel="lrdd" type="application/jrd+json" template="${webfingerTemplate}"/>
</XRD>
`;
    res.set('Content-Type', 'application/xrd+xml; charset=utf-8');
    res.set('Cache-Control', HOST_META_CACHE_CONTROL);
    return res.send(xrd);
  });

  router.get('/host-meta.json', (_req: Request, res: Response) => {
    if (!config.federationEnabled) {
      return res.status(404).json({ error: 'Federation is disabled' });
    }
    res.set('Content-Type', 'application/jrd+json; charset=utf-8');
    res.set('Cache-Control', HOST_META_CACHE_CONTROL);
    return res.json({
      links: [
        {
          rel: 'lrdd',
          type: 'application/jrd+json',
          template: webfingerTemplate,
        },
      ],
    });
  });

  return router;
}
