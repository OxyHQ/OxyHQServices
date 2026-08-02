/**
 * Parsing for `POST /auth/oauth/token`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIALECT RULE (this is the single place it is defined)
 * ─────────────────────────────────────────────────────────────────────────────
 * One endpoint serves two wire dialects, because Oxy shipped a non-standard
 * one before it needed a standards-compliant one and both must keep working:
 *
 *  • `rfc6749` — the standard. Snake_case parameters, a mandatory `grant_type`,
 *    client credentials via HTTP Basic (RFC 6749 §2.3.1 `client_secret_basic`)
 *    or via the body (`client_secret_post`), and a FLAT JSON response
 *    (§5.1 / §5.2). This is what Matrix Authentication Service and every other
 *    conforming OAuth2/OIDC client speaks.
 *
 *  • `legacy` — the original Oxy shape. CamelCase parameters (`clientId`,
 *    `redirectUri`, `clientSecret`, `codeVerifier`), no `grant_type`, and the
 *    API-wide `{ data: … }` envelope. `@oxyhq/core`'s `exchangeOAuthCode` and
 *    every integration written against `docs/auth/integration-guide.md` speak
 *    this.
 *
 * A request is `rfc6749` when it carries ANY of these signals:
 *   - an `Authorization: Basic …` header, or
 *   - any snake_case RFC parameter in the body: `grant_type`, `client_id`,
 *     `client_secret`, `redirect_uri`, `code_verifier`, `refresh_token`.
 * Otherwise it is `legacy`.
 *
 * The dialect chosen here decides the RESPONSE shape too — a client always gets
 * back the dialect it spoke, so adding RFC support cannot change a single byte
 * for an existing caller. `grant_type` is REQUIRED in the RFC dialect (§4.1.3),
 * so a half-migrated client that sends snake_case parameters without it gets a
 * flat `invalid_request` rather than being silently reinterpreted.
 *
 * The legacy dialect only ever supported the authorization-code exchange, so
 * `grant_type=refresh_token` is by construction RFC-only.
 *
 * This module is pure: no I/O, no database, no Express `Response`. It turns an
 * untrusted body + headers into a validated, normalised grant request or throws
 * the correctly-shaped error for the dialect it detected.
 */

import { ZodError } from 'zod';
import {
  oauthAuthorizationCodeGrantSchema,
  oauthRefreshTokenGrantSchema,
} from '../schemas/auth.schemas';
import { BadRequestError } from './error';
import { OAuthProtocolError } from './oauthError';

/** Which wire dialect the caller spoke — and therefore which response it gets. */
export type OAuthTokenDialect = 'rfc6749' | 'legacy';

/** Grant types this endpoint implements. */
export type OAuthGrantType = 'authorization_code' | 'refresh_token';

/**
 * The body parameters that only exist in the RFC dialect. Presence of any one
 * of them (or of HTTP Basic credentials) selects `rfc6749`.
 */
const RFC_BODY_PARAMETERS = [
  'grant_type',
  'client_id',
  'client_secret',
  'redirect_uri',
  'code_verifier',
  'refresh_token',
] as const;

/** Client credentials, whichever RFC 6749 §2.3.1 method delivered them. */
export interface OAuthClientCredentials {
  clientId: string;
  clientSecret?: string;
  /**
   * True when the credentials arrived in the `Authorization` header. RFC 6749
   * §5.2 REQUIRES a `WWW-Authenticate` challenge on `invalid_client` in that
   * case, so the route needs to know.
   */
  viaBasicAuth: boolean;
}

export interface OAuthAuthorizationCodeRequest {
  dialect: OAuthTokenDialect;
  grantType: 'authorization_code';
  client: OAuthClientCredentials;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface OAuthRefreshTokenRequest {
  /** Refresh is RFC-only: the legacy dialect never had a grant selector. */
  dialect: 'rfc6749';
  grantType: 'refresh_token';
  client: OAuthClientCredentials;
  refreshToken: string;
  scope?: string;
}

export type OAuthTokenRequest = OAuthAuthorizationCodeRequest | OAuthRefreshTokenRequest;

/** The subset of an Express request this parser reads. */
export interface OAuthTokenRequestInput {
  body: unknown;
  authorizationHeader?: string | string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read a single form/JSON parameter.
 *
 * RFC 6749 §3.1: "Parameters sent without a value MUST be treated as if they
 * were omitted" and "Request and response parameters MUST NOT be included more
 * than once". `express.urlencoded({ extended: true })` surfaces a repeated
 * parameter as an array, which is exactly the duplicate the spec forbids —
 * rejecting it also removes any chance of a parameter-smuggling parser
 * mismatch between us and an upstream proxy.
 */
function readParameter(body: Record<string, unknown>, name: string): string | undefined {
  const value = body[name];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new OAuthProtocolError(
      'invalid_request',
      `Parameter "${name}" must be sent exactly once as a string value`,
    );
  }
  return value.length > 0 ? value : undefined;
}

/** First value of a possibly-repeated header. */
function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Decode `Authorization: Basic base64(client_id:client_secret)`.
 *
 * Per RFC 6749 §2.3.1 both halves are `application/x-www-form-urlencoded`
 * percent-encoded BEFORE base64, so they must be decoded again here —
 * otherwise a client id or secret containing `:`, `+` or a non-ASCII byte
 * would silently mismatch. Returns `undefined` when the header is absent or is
 * not a Basic challenge (a Bearer header on this endpoint is not client
 * authentication and is ignored).
 */
export function decodeBasicClientCredentials(
  authorizationHeader: string | string[] | undefined,
): { clientId: string; clientSecret: string } | undefined {
  const header = firstHeaderValue(authorizationHeader)?.trim();
  if (!header) {
    return undefined;
  }

  const [scheme, ...rest] = header.split(/\s+/);
  if (scheme?.toLowerCase() !== 'basic') {
    return undefined;
  }

  const encoded = rest.join('');
  if (!encoded) {
    throw new OAuthProtocolError('invalid_client', 'Malformed Basic authorization header');
  }

  let decoded: string;
  try {
    const buffer = Buffer.from(encoded, 'base64');
    // Buffer.from is lenient: it silently drops invalid base64 characters.
    // Re-encoding and comparing rejects a header that was never valid base64.
    if (buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
      throw new OAuthProtocolError('invalid_client', 'Malformed Basic authorization header');
    }
    decoded = buffer.toString('utf8');
  } catch (error) {
    if (error instanceof OAuthProtocolError) {
      throw error;
    }
    throw new OAuthProtocolError('invalid_client', 'Malformed Basic authorization header');
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    throw new OAuthProtocolError('invalid_client', 'Malformed Basic authorization header');
  }

  const clientId = formUrlDecode(decoded.slice(0, separatorIndex));
  const clientSecret = formUrlDecode(decoded.slice(separatorIndex + 1));
  if (!clientId || !clientSecret) {
    throw new OAuthProtocolError('invalid_client', 'Malformed Basic authorization header');
  }

  return { clientId, clientSecret };
}

/** Reverse `application/x-www-form-urlencoded` encoding of one component. */
function formUrlDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw new OAuthProtocolError('invalid_client', 'Malformed Basic authorization header');
  }
}

/** True when the request speaks the RFC dialect. See THE DIALECT RULE above. */
export function detectDialect(input: OAuthTokenRequestInput): OAuthTokenDialect {
  const header = firstHeaderValue(input.authorizationHeader)?.trim();
  if (header && header.split(/\s+/)[0]?.toLowerCase() === 'basic') {
    return 'rfc6749';
  }
  const body = input.body;
  if (isRecord(body) && RFC_BODY_PARAMETERS.some((name) => name in body)) {
    return 'rfc6749';
  }
  return 'legacy';
}

/**
 * Validate normalised parameters, re-throwing Zod failures in the shape the
 * detected dialect expects: a flat `invalid_request` for RFC callers, and the
 * unchanged `{ error: 'BAD_REQUEST', message: 'Validation failed', details }`
 * body legacy callers have always received.
 */
function parseWithDialect<T>(
  schema: { parse: (value: unknown) => T },
  value: unknown,
  dialect: OAuthTokenDialect,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (!(error instanceof ZodError)) {
      throw error;
    }
    if (dialect === 'legacy') {
      throw new BadRequestError('Validation failed', {
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      });
    }
    const summary = error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new OAuthProtocolError('invalid_request', summary);
  }
}

/**
 * Resolve client credentials from HTTP Basic and/or the request body.
 *
 * RFC 6749 §2.3: "The client MUST NOT use more than one authentication method
 * in each request." Presenting a Basic header AND a body `client_secret` is
 * therefore rejected rather than silently resolved to one of them, and a body
 * `client_id` that contradicts the Basic one is rejected too.
 */
function resolveRfcClientCredentials(
  body: Record<string, unknown>,
  authorizationHeader: string | string[] | undefined,
): OAuthClientCredentials {
  const basic = decodeBasicClientCredentials(authorizationHeader);
  const bodyClientId = readParameter(body, 'client_id');
  const bodyClientSecret = readParameter(body, 'client_secret');

  if (basic) {
    if (bodyClientSecret !== undefined) {
      throw new OAuthProtocolError(
        'invalid_request',
        'Use either the Authorization header or client_secret in the body, not both',
      );
    }
    if (bodyClientId !== undefined && bodyClientId !== basic.clientId) {
      throw new OAuthProtocolError(
        'invalid_request',
        'client_id in the body contradicts the Authorization header',
      );
    }
    return { clientId: basic.clientId, clientSecret: basic.clientSecret, viaBasicAuth: true };
  }

  if (bodyClientId === undefined) {
    throw new OAuthProtocolError('invalid_request', 'client_id is required');
  }

  return {
    clientId: bodyClientId,
    ...(bodyClientSecret !== undefined ? { clientSecret: bodyClientSecret } : {}),
    viaBasicAuth: false,
  };
}

/**
 * Parse and validate a token request in whichever dialect it was sent.
 *
 * @throws {OAuthProtocolError} for RFC-dialect failures (flat §5.2 body).
 * @throws {BadRequestError} for legacy-dialect validation failures (unchanged
 *   envelope), so existing clients see byte-identical errors.
 */
export function parseOAuthTokenRequest(input: OAuthTokenRequestInput): OAuthTokenRequest {
  const dialect = detectDialect(input);

  if (!isRecord(input.body)) {
    if (dialect === 'legacy') {
      throw new BadRequestError('Validation failed', {
        issues: [{ path: '', message: 'Expected object', code: 'invalid_type' }],
      });
    }
    throw new OAuthProtocolError('invalid_request', 'Request body must be a parameter set');
  }
  const body = input.body;

  if (dialect === 'legacy') {
    const params = parseWithDialect(oauthAuthorizationCodeGrantSchema, body, dialect);
    return {
      dialect,
      grantType: 'authorization_code',
      client: {
        clientId: params.clientId,
        ...(params.clientSecret !== undefined ? { clientSecret: params.clientSecret } : {}),
        viaBasicAuth: false,
      },
      code: params.code,
      redirectUri: params.redirectUri,
      ...(params.codeVerifier !== undefined ? { codeVerifier: params.codeVerifier } : {}),
    };
  }

  const grantType = readParameter(body, 'grant_type');
  if (grantType === undefined) {
    // RFC 6749 §4.1.3 / §6 — `grant_type` is REQUIRED.
    throw new OAuthProtocolError('invalid_request', 'grant_type is required');
  }
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    throw new OAuthProtocolError(
      'unsupported_grant_type',
      `Unsupported grant_type "${grantType}"`,
    );
  }

  const client = resolveRfcClientCredentials(body, input.authorizationHeader);

  if (grantType === 'refresh_token') {
    const params = parseWithDialect(
      oauthRefreshTokenGrantSchema,
      {
        clientId: client.clientId,
        ...(client.clientSecret !== undefined ? { clientSecret: client.clientSecret } : {}),
        refreshToken: readParameter(body, 'refresh_token'),
        scope: readParameter(body, 'scope'),
      },
      dialect,
    );
    return {
      dialect: 'rfc6749',
      grantType: 'refresh_token',
      client,
      refreshToken: params.refreshToken,
      ...(params.scope !== undefined ? { scope: params.scope } : {}),
    };
  }

  const params = parseWithDialect(
    oauthAuthorizationCodeGrantSchema,
    {
      code: readParameter(body, 'code'),
      clientId: client.clientId,
      redirectUri: readParameter(body, 'redirect_uri'),
      ...(client.clientSecret !== undefined ? { clientSecret: client.clientSecret } : {}),
      codeVerifier: readParameter(body, 'code_verifier'),
    },
    dialect,
  );

  return {
    dialect: 'rfc6749',
    grantType: 'authorization_code',
    client,
    code: params.code,
    redirectUri: params.redirectUri,
    ...(params.codeVerifier !== undefined ? { codeVerifier: params.codeVerifier } : {}),
  };
}
