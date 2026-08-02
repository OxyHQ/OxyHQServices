/**
 * OAuth 2.0 / OpenID Connect provider metadata (discovery).
 *
 * Served at the API ROOT — not under `/auth` — because both specs fix the path
 * relative to the issuer:
 *   - RFC 8414 §3:                     `/.well-known/oauth-authorization-server`
 *   - OpenID Connect Discovery §4:     `/.well-known/openid-configuration`
 * Most clients (Matrix Authentication Service among them) probe the OIDC path,
 * so both are served and return the same document.
 *
 * The document is deliberately HONEST about what this provider does:
 *
 *  - `response_types_supported` is `["code"]` only. The implicit and hybrid
 *    flows are not implemented and never will be.
 *  - `code_challenge_methods_supported` is `["S256"]` only; `plain` is refused
 *    by `POST /auth/oauth/authorize` per current OAuth BCP.
 *  - There is NO `jwks_uri` and NO `id_token_signing_alg_values_supported`,
 *    because this provider does not issue ID tokens. Oxy session tokens are
 *    HMAC-signed with a secret that has no public half to publish, so a JWKS
 *    would be an empty document and an advertised `id_token` signing algorithm
 *    would be a claim we cannot honour. Relying parties obtain identity from
 *    the UserInfo endpoint instead (for MAS: `fetch_userinfo: true`).
 *  - `claims_supported` lists exactly what `GET /auth/oauth/userinfo` can
 *    return. `email_verified` is absent because Oxy stores no per-address
 *    verification state.
 *
 * Public, unauthenticated, cacheable, CORS-open: discovery metadata is public
 * infrastructure, and a relying party must be able to fetch it from anywhere.
 */

import { Router, type Request, type Response } from 'express';
import {
  OAUTH_AUTHORIZATION_ENDPOINT,
  OAUTH_ISSUER,
  OAUTH_TOKEN_ENDPOINT,
  OAUTH_USERINFO_ENDPOINT,
} from '../config/oauth';
import { APPLICATION_SCOPES } from '../utils/applicationScopes';

const router = Router();

/**
 * How long a relying party may cache the document. Endpoints and capabilities
 * change at deploy cadence, not request cadence, so an hour is safe and keeps
 * discovery off the hot path.
 */
const METADATA_MAX_AGE_SECONDS = 3600;

/**
 * OIDC standard scopes this provider understands. `openid` selects the OIDC
 * behaviour, `profile` and `email` map onto the claims UserInfo returns; the
 * platform's own application scopes follow.
 */
const OIDC_STANDARD_SCOPES = ['openid', 'profile', 'email'] as const;

/** Claims `GET /auth/oauth/userinfo` can return. Keep in sync with it. */
const SUPPORTED_CLAIMS = [
  'sub',
  'preferred_username',
  'name',
  'given_name',
  'family_name',
  'picture',
  'email',
  'updated_at',
] as const;

function buildProviderMetadata(): Record<string, unknown> {
  return {
    issuer: OAUTH_ISSUER,
    authorization_endpoint: OAUTH_AUTHORIZATION_ENDPOINT,
    token_endpoint: OAUTH_TOKEN_ENDPOINT,
    userinfo_endpoint: OAUTH_USERINFO_ENDPOINT,
    scopes_supported: [...OIDC_STANDARD_SCOPES, ...APPLICATION_SCOPES],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    subject_types_supported: ['public'],
    token_endpoint_auth_methods_supported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    code_challenge_methods_supported: ['S256'],
    claims_supported: [...SUPPORTED_CLAIMS],
    claims_parameter_supported: false,
    request_parameter_supported: false,
    request_uri_parameter_supported: false,
  };
}

function sendProviderMetadata(_req: Request, res: Response): void {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', `public, max-age=${METADATA_MAX_AGE_SECONDS}`);
  res.status(200).json(buildProviderMetadata());
}

router.get('/.well-known/openid-configuration', sendProviderMetadata);
router.get('/.well-known/oauth-authorization-server', sendProviderMetadata);

export default router;
