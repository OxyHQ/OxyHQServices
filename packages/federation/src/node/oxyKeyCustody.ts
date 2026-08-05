/**
 * Oxy-custodied signing keys — the DEFAULT implementation of the private-key
 * seam every Oxy app's ActivityPub federation needs.
 *
 * Oxy owns all federation key material. `federation_key_pairs` is keyed by the
 * canonical `https://<domain>/ap/users/<username>#main-key` keyId, and that
 * uniqueness is what gives each app its own actor key by construction: `bob` on
 * `mention.earth` is a different row from `bob` on `syra.fm`. This module is the
 * client half of that arrangement — it fetches the PUBLIC half to publish in an
 * actor document (`GET /federation/public-key/:username?domain=`) and asks Oxy to
 * sign on the app's behalf (`POST /federation/sign`). The private key never
 * enters this package, and never enters the consuming app.
 *
 * The transport is injected ({@link OxyKeyCustodyConfig.makeServiceRequest} — the
 * same service-scoped `ServiceRequest` the identity bridge takes), because both
 * endpoints require a credential carrying the `federation:write` scope. oxy-api
 * additionally refuses a `domain` (and a keyId host) that is not registered for
 * the requesting Application, so an app can only ever sign for its own domain.
 *
 * Extracted from Mention's `connectors/activitypub/crypto.ts`, which was the
 * only implementation and is app-agnostic apart from its domain constant. The
 * public-key cache is per-INSTANCE here rather than module-global as it was
 * there: an instance is bound to one domain, so a process federating for two
 * domains gets two caches instead of one that answers the wrong keyId.
 */

import { getErrorMessage, getErrorStatus } from '@oxyhq/core';
import type { HttpSignatureSigner } from '../httpSignature';
import type { ServiceRequest } from './identityBridge';

/**
 * Public-key material for an actor, as advertised in its ActivityPub `publicKey`
 * block. Satisfies both `DeliveryKeys.getPublicKey` and
 * `ActorRouterConfig.getPublicKey`.
 */
export interface FederationPublicKey {
  keyId: string;
  publicKeyPem: string;
}

/** Minimal logging sink the key custody writes to. */
export interface KeyCustodyLogger {
  debug(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

/** Adapters the Oxy key custody is built from. */
export interface OxyKeyCustodyConfig {
  /** Service-scoped oxy-api request transport (unwraps the API's `{ data }` envelope). */
  makeServiceRequest: ServiceRequest;
  /**
   * The federation domain this app serves actors on. Sent as the `domain` query
   * parameter, and it MUST be one of the requesting Application's registered
   * hosts or oxy-api answers 403 — that check is what binds an app to its own
   * actors.
   */
  domain: string;
  /**
   * How long a fetched public key stays cached in memory. A keyId is derived
   * from (username, domain) and its PEM is stable, so this only avoids a
   * round-trip per actor render. Defaults to one hour.
   */
  publicKeyCacheTtlMs?: number;
  /** Diagnostics sink. */
  logger: KeyCustodyLogger;
}

/** Oxy-custodied signing keys for one federation domain. */
export interface OxyKeyCustody {
  /**
   * The domain-scoped keyId + public PEM for `username`'s actor. THROWS on a
   * failed or malformed lookup: without it the actor document is incomplete and
   * no remote server can verify this app's signatures, so it must not degrade
   * into publishing an actor with no key.
   */
  getPublicKey(username: string): Promise<FederationPublicKey>;
  /**
   * Sign an HTTP-Signature signing string with the private key backing `keyId`.
   * THROWS on failure — an unsigned outbound request is not a weaker request,
   * it is one every receiving instance rejects.
   */
  sign: HttpSignatureSigner;
  /**
   * Drop the cached public key for `username` (all of them when omitted). For a
   * key rotation: the next read re-fetches from Oxy.
   */
  invalidatePublicKey(username?: string): void;
}

/** Default public-key cache TTL: one hour. */
const DEFAULT_PUBLIC_KEY_CACHE_TTL_MS = 60 * 60 * 1000;

/** Longest error detail carried into a thrown message before truncation. */
const MAX_ERROR_DETAIL_LENGTH = 300;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** The `{ data }`-unwrapped body oxy-api returns for `GET /federation/public-key/:username`. */
interface OxyPublicKeyResponse {
  keyId?: unknown;
  publicKeyPem?: unknown;
}

/** The `{ data }`-unwrapped body oxy-api returns for `POST /federation/sign`. */
interface OxySignResponse {
  signature?: unknown;
}

/**
 * The error shapes the Oxy service client throws, beyond what `getErrorMessage`
 * already reads. `@oxyhq/core`'s `HttpService` funnels failures through
 * `handleHttpError`, which returns an `ApiError` PLAIN OBJECT — so
 * `err instanceof Error` is false and a naive `String(err)` yields
 * `"[object Object]"`. Other layers throw a real `Error` (missing service
 * credentials) or an axios-style object, so this stays wide.
 */
interface ServiceClientErrorExtras {
  response?: { statusText?: unknown; data?: unknown };
  data?: unknown;
  body?: unknown;
}

function asErrorExtras(value: unknown): ServiceClientErrorExtras | undefined {
  return value && typeof value === 'object' ? (value as ServiceClientErrorExtras) : undefined;
}

/**
 * A meaningful message from whatever the service client threw, whatever its
 * shape. `getErrorMessage` covers a string, an `Error`, `.message`, `.error` and
 * `response.data.message`; the fallbacks below cover the shapes it does not —
 * a string body, a serializable object body, and `statusText` — because these
 * two endpoints are exactly where a failure was historically invisible. NEVER
 * returns `[object Object]`.
 *
 * Response bodies never reach the structured LOGS (see
 * {@link serviceErrorLogContext}); they only ever ride the thrown message.
 */
function describeServiceError(error: unknown): string {
  const status = getErrorStatus(error);
  const extras = asErrorExtras(error);

  // `getErrorMessage`'s fallback is a fixed sentence, so ask for an empty one and
  // treat "" as "core found nothing" rather than as a message.
  let detail: string | undefined = getErrorMessage(error, '') || undefined;

  if (!detail && extras) {
    const body = extras.response?.data ?? extras.data ?? extras.body;
    if (isNonEmptyString(body)) {
      detail = body;
    } else if (body !== undefined && body !== null) {
      try {
        detail = JSON.stringify(body);
      } catch {
        // Circular / non-serializable body — leave the detail unset.
      }
    }
    if (!detail && isNonEmptyString(extras.response?.statusText)) {
      detail = extras.response.statusText;
    }
  }

  if (detail && detail.length > MAX_ERROR_DETAIL_LENGTH) {
    detail = `${detail.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`;
  }

  if (status !== undefined) {
    // Avoid a doubled "HTTP 429: HTTP 429: …" when the detail already names it.
    if (detail?.includes(String(status))) return detail;
    return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`;
  }
  if (detail) return detail;

  try {
    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}' && serialized !== 'null') return serialized;
  } catch {
    // Circular / non-serializable — fall through to String().
  }
  const asString = String(error);
  return asString === '[object Object]' ? 'unknown error' : asString;
}

/**
 * The structured-log context for a failed call: status and kind ONLY. Response
 * bodies and free-form error content are deliberately excluded — a signing
 * failure's body can quote request material, and these logs are shipped.
 */
function serviceErrorLogContext(error: unknown): { status?: number; errorKind: string } {
  return {
    status: getErrorStatus(error),
    errorKind:
      error instanceof Error ? 'Error' : error && typeof error === 'object' ? 'service-client' : typeof error,
  };
}

/** Build the Oxy-custodied key adapter for one federation domain. */
export function createOxyKeyCustody(config: OxyKeyCustodyConfig): OxyKeyCustody {
  const ttlMs = config.publicKeyCacheTtlMs ?? DEFAULT_PUBLIC_KEY_CACHE_TTL_MS;
  const cache = new Map<string, { data: FederationPublicKey; fetchedAt: number }>();

  return {
    async getPublicKey(username): Promise<FederationPublicKey> {
      const cached = cache.get(username);
      if (cached && Date.now() - cached.fetchedAt < ttlMs) {
        return cached.data;
      }

      const path = `/federation/public-key/${encodeURIComponent(username)}?domain=${encodeURIComponent(config.domain)}`;
      let response: OxyPublicKeyResponse;
      try {
        response = await config.makeServiceRequest<OxyPublicKeyResponse>('GET', path);
      } catch (error) {
        config.logger.error('[Federation] public-key lookup failed', serviceErrorLogContext(error));
        throw new Error(`Failed to fetch federation public key: ${describeServiceError(error)}`);
      }

      if (!isNonEmptyString(response?.keyId) || !isNonEmptyString(response?.publicKeyPem)) {
        config.logger.error('[Federation] public-key lookup returned a malformed payload');
        throw new Error('Malformed federation public-key response');
      }

      const data: FederationPublicKey = { keyId: response.keyId, publicKeyPem: response.publicKeyPem };
      cache.set(username, { data, fetchedAt: Date.now() });
      config.logger.debug('[Federation] public key fetched');
      return data;
    },

    async sign(keyId, signingString): Promise<string> {
      let response: OxySignResponse;
      try {
        response = await config.makeServiceRequest<OxySignResponse>('POST', '/federation/sign', {
          keyId,
          signingString,
        });
      } catch (error) {
        // A signing failure means every outbound signed request for this key
        // fails. Surface at error level so the outage is observable.
        config.logger.error('[Federation] signing request failed', serviceErrorLogContext(error));
        throw new Error(`Failed to sign via Oxy: ${describeServiceError(error)}`);
      }

      if (!isNonEmptyString(response?.signature)) {
        config.logger.error('[Federation] signing request returned a malformed payload');
        throw new Error('Malformed federation signing response');
      }

      return response.signature;
    },

    invalidatePublicKey(username): void {
      if (username === undefined) {
        cache.clear();
        return;
      }
      cache.delete(username);
    },
  };
}
