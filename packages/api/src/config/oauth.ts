/**
 * OAuth 2.0 / OpenID Connect provider identity.
 *
 * These values are what an external Authorization Server integrator (e.g.
 * Matrix Authentication Service configured with Oxy as its upstream provider)
 * reads out of the discovery document, so they MUST be absolute, https, and
 * resolvable from the public internet.
 *
 * `issuer` has one hard constraint: OpenID Connect Discovery §4.3 requires it
 * to be identical to the URL the discovery document was fetched from, minus the
 * `/.well-known/...` suffix. The defaults keep that true for the standard
 * deployment (`https://api.<FEDERATION_DOMAIN>/.well-known/openid-configuration`
 * → issuer `https://api.<FEDERATION_DOMAIN>`). Any deployment that terminates
 * the API on a different public origin MUST set `OAUTH_ISSUER` to match.
 *
 * The authorization endpoint is NOT on this API: the browser-facing consent
 * screen is the Oxy auth web app, which already reads the RFC 6749 §4.1.1
 * query parameters (`client_id`, `redirect_uri`, `state`, `code_challenge`,
 * `code_challenge_method`, `scope`) and then calls this API's
 * `POST /auth/oauth/authorize` on the user's behalf.
 */

import { logger } from '../utils/logger';

/** Shared with the ActivityPub/DID layer — the platform's canonical apex. */
const DEFAULT_FEDERATION_DOMAIN = 'oxy.so';

const federationDomain = process.env.FEDERATION_DOMAIN || DEFAULT_FEDERATION_DOMAIN;

/**
 * Validate an https origin/URL from the environment. Returns the fallback and
 * logs loudly when the value is unusable — a malformed issuer would otherwise
 * produce a discovery document that every conforming client silently rejects.
 */
function resolveHttpsUrl(envName: string, rawValue: string | undefined, fallback: string): string {
  if (!rawValue) {
    return fallback;
  }
  try {
    const parsed = new URL(rawValue.trim());
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost') {
      logger.error(`[OAuth] ${envName} must be an https URL; falling back to ${fallback}`);
      return fallback;
    }
    // Strip a trailing slash so `${issuer}/auth/oauth/token` never doubles up.
    return parsed.toString().replace(/\/$/, '');
  } catch {
    logger.error(`[OAuth] ${envName} is not a valid URL; falling back to ${fallback}`);
    return fallback;
  }
}

/** The OAuth 2.0 / OIDC issuer identifier. Also the API's public origin. */
export const OAUTH_ISSUER = resolveHttpsUrl(
  'OAUTH_ISSUER',
  process.env.OAUTH_ISSUER,
  `https://api.${federationDomain}`,
);

/** Browser-facing authorization endpoint (the Oxy auth web app). */
export const OAUTH_AUTHORIZATION_ENDPOINT = resolveHttpsUrl(
  'OAUTH_AUTHORIZATION_ENDPOINT',
  process.env.OAUTH_AUTHORIZATION_ENDPOINT,
  `https://auth.${federationDomain}/authorize`,
);

/** RFC 6749 §3.2 token endpoint. */
export const OAUTH_TOKEN_ENDPOINT = `${OAUTH_ISSUER}/auth/oauth/token`;

/** OpenID Connect Core §5.3 UserInfo endpoint. */
export const OAUTH_USERINFO_ENDPOINT = `${OAUTH_ISSUER}/auth/oauth/userinfo`;
