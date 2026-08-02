/**
 * RFC 6749 §5.2 token-endpoint error responses.
 *
 * The OAuth2 spec mandates a FLAT JSON error body:
 *
 *   { "error": "invalid_grant", "error_description": "…" }
 *
 * which is incompatible with the API-wide `{ data: … }` / `{ error, message }`
 * envelope produced by `ApiError.toJSON()`. `OAuthProtocolError` is an
 * `ApiError` subclass that overrides `toJSON()` so BOTH error paths — the
 * `asyncHandler` catch and the global `errorHandler` middleware — serialise it
 * in the spec shape without either of them needing to know about OAuth.
 *
 * Status codes follow RFC 6749 §5.2: 400 for every code except
 * `invalid_client`, which is 401 (the spec permits 400 or 401 and REQUIRES 401
 * when the client authenticated via the `Authorization` header). Callers that
 * used HTTP Basic must also receive a `WWW-Authenticate` challenge; that header
 * is set by the route because only it holds the `Response`.
 */

import { ApiError } from './error';

/**
 * The token-endpoint error codes defined by RFC 6749 §5.2. `invalid_scope` and
 * `unauthorized_client` are part of the registry even though the current
 * grant implementations do not emit them; keeping the union complete means a
 * future grant cannot invent an unregistered code.
 */
export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope';

/** RFC 6749 §5.2 status code for each error code. */
const OAUTH_ERROR_STATUS: Record<OAuthErrorCode, number> = {
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 400,
  unsupported_grant_type: 400,
  invalid_scope: 400,
};

/**
 * An RFC 6749 §5.2 error, serialised flat.
 *
 * `error_description` is optional and, per the spec, is meant for the
 * developer — never for an end user and never a place to leak WHY a credential
 * failed. Descriptions here stay deliberately coarse (they must not let an
 * attacker distinguish "unknown code" from "expired code" from "wrong
 * redirect_uri"), matching the opacity the legacy dialect already had.
 */
export class OAuthProtocolError extends ApiError {
  public readonly oauthError: OAuthErrorCode;
  public readonly errorDescription?: string;

  constructor(oauthError: OAuthErrorCode, errorDescription?: string) {
    super(OAUTH_ERROR_STATUS[oauthError], errorDescription ?? oauthError, oauthError);
    this.name = 'OAuthProtocolError';
    this.oauthError = oauthError;
    this.errorDescription = errorDescription;
  }

  override toJSON(): { error: OAuthErrorCode; error_description?: string } {
    return {
      error: this.oauthError,
      ...(this.errorDescription ? { error_description: this.errorDescription } : {}),
    };
  }
}
