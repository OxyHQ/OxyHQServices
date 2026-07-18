/**
 * Federation Service
 *
 * Resolves fediverse (ActivityPub) handles to Oxy user profiles.
 * Handles WebFinger discovery, actor profile fetching, avatar download, and user upsert.
 * Signs outgoing requests with HTTP Signatures for servers that enforce authorized fetch.
 */

import crypto from 'crypto';
import type { IncomingMessage } from 'http';
import mongoose from 'mongoose';
import { signRequest } from '@oxyhq/federation';
import { safeFetch, SsrfRejection, type SafeFetchResult } from '@oxyhq/core/server';
import User, { type IUser, type AccountKind } from '../models/User';
import { AssetService } from './assetService';
import { createS3Service } from './s3Service';
import { logger } from '../utils/logger';
import userCache from '../utils/userCache';
import { composeDisplayName } from '../utils/displayName';
import { cleanDisplayName } from '../utils/displayNameSanitize';
import { sanitizePlainText, decodeHtmlEntities } from '../utils/sanitize';

const AP_ACCEPT_TYPES = [
  'application/activity+json',
  'application/ld+json; profile="https://www.w3.org/ns/activitystreams"',
];

const AP_DOMAIN = process.env.FEDERATION_DOMAIN || 'oxy.so';
const USER_AGENT = 'OxyHQ/1.0 (ActivityPub)';

/**
 * Oxy's OWN federation apex domain(s). The fediverse treats `oxy.so` as a
 * remote ActivityPub origin, but it is in fact our own apex: a handle like
 * `nate@oxy.so` denotes the LOCAL user `nate`, NOT a remote actor. Resolving
 * such a handle must never WebFinger our own apex nor mint a `type:'federated'`
 * shadow row — that duplicates the real local user and shadows it in search.
 *
 * The set is the configured {@link AP_DOMAIN} plus any extra aliases supplied
 * via the optional comma-separated `FEDERATION_OWN_DOMAINS` env (e.g. a legacy
 * apex). Entries are trimmed, lowercased, and de-duplicated.
 *
 * This is the SINGLE source of truth for the own-domain set; consumers
 * (`routes/users.ts`, the dedupe script) import {@link isOwnFederationDomain}
 * or {@link OWN_FEDERATION_DOMAINS} from here rather than copying the constant.
 */
export const OWN_FEDERATION_DOMAINS: ReadonlySet<string> = new Set(
  [AP_DOMAIN, ...(process.env.FEDERATION_OWN_DOMAINS ?? '').split(',')]
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0),
);

/**
 * True when `domain` is one of Oxy's own federation domains (case-insensitive).
 * Strips a leading `www.` so `www.oxy.so` matches the apex entry.
 * Callers short-circuit resolution for own-domain handles (return null / reject
 * 400) so they never mint a `type:'federated'` shadow row.
 */
export function isOwnFederationDomain(domain: string): boolean {
  const normalized = domain.trim().toLowerCase();
  const canonical = normalized.startsWith('www.') ? normalized.slice(4) : normalized;
  return OWN_FEDERATION_DOMAINS.has(canonical);
}

/**
 * A cached federated record older than this is considered stale and triggers a
 * background refresh on the next resolve. The cached record is still returned
 * immediately — the refresh runs fire-and-forget. Bluesky-style: fast now,
 * eventually fresh.
 */
const STALE_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Minimum gap between background refresh attempts for the same actor. Guards
 * against refresh storms when many requests hit a stale record at once (each
 * request would otherwise schedule its own background fetch).
 */
const REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Minimum gap between forced avatar re-downloads for the same user. Even when a
 * caller passes `refresh: true` to PUT /users/resolve, we skip re-downloading
 * the avatar if it was fetched within this window. The persisted
 * `federation.lastAvatarFetchedAt` is the authority across restarts; the
 * in-memory {@link _lastAvatarAttemptAt} map coalesces bursts within a process.
 * 5 minutes matches {@link REFRESH_MIN_INTERVAL_MS} — a single avatar can't
 * meaningfully change faster than the actor record it belongs to.
 */
const AVATAR_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

const FEDIVERSE_HANDLE_REGEX = /^@?[\w.-]+@[\w.-]+\.\w+$/;

/** Time-to-first-byte deadline for federation control-plane fetches (webfinger/actor). */
const FEDERATION_FETCH_TIMEOUT_MS = 10_000;
/** Time-to-first-byte deadline for avatar/media downloads. */
const FEDERATION_AVATAR_FETCH_TIMEOUT_MS = 15_000;
/** Hard cap on a remote avatar's body size (matches the historical 5MB limit). */
const FEDERATION_MAX_AVATAR_BYTES = 5 * 1024 * 1024;
/**
 * Hard cap on a federation JSON document (WebFinger JRD / ActivityPub actor).
 * Generous for legitimate actor objects, but bounds a hostile peer streaming an
 * unbounded body to exhaust memory.
 */
const FEDERATION_MAX_JSON_BYTES = 2 * 1024 * 1024;

/**
 * SSRF-safe federation fetch. All outbound federation traffic is funnelled here
 * so it inherits {@link safeFetch}'s DNS-pinned, redirect-revalidating,
 * private/metadata-IP denylisting protection (closing the DNS-rebind TOCTOU).
 * Restricted to https only — federation never legitimately targets http.
 *
 * Returns the validated, non-redirect {@link SafeFetchResult}, or `null` when the
 * URL is not https, is rejected by the SSRF guard, or the request fails. The
 * caller OWNS the returned `response` stream — read it via the bounded readers
 * below, which always destroy the stream.
 */
async function safeFederationFetch(
  rawUrl: string,
  options: { headers?: Record<string, string>; timeoutMs?: number; maxRedirects?: number } = {},
): Promise<SafeFetchResult | null> {
  let protocol: string;
  try {
    protocol = new URL(rawUrl).protocol;
  } catch {
    logger.warn(`Federation URL rejected: malformed ${rawUrl}`);
    return null;
  }
  if (protocol !== 'https:') {
    logger.warn(`Federation URL rejected: non-https protocol for ${rawUrl}`);
    return null;
  }

  try {
    return await safeFetch(rawUrl, {
      method: 'GET',
      headers: options.headers,
      headersTimeoutMs: options.timeoutMs ?? FEDERATION_FETCH_TIMEOUT_MS,
      signal: AbortSignal.timeout(options.timeoutMs ?? FEDERATION_FETCH_TIMEOUT_MS),
      maxRedirects: options.maxRedirects,
    });
  } catch (err) {
    if (err instanceof SsrfRejection) {
      logger.warn(`Federation URL rejected by SSRF guard (${err.message}): ${rawUrl}`);
      return null;
    }
    logger.warn(`Federation fetch failed for ${rawUrl}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Read an {@link IncomingMessage} body into a Buffer, aborting (and destroying
 * the stream) the moment it would exceed `maxBytes`. Returns `null` when the cap
 * is exceeded. The caller should short-circuit on the advertised
 * `content-length` (from the validated response headers) before calling this.
 */
function readBodyLimited(response: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const finish = (value: Buffer | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    response.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        response.destroy();
        finish(null);
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => finish(Buffer.concat(chunks, total)));
    response.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    response.on('close', () => finish(null));
  });
}

/**
 * Read a bounded JSON document from an {@link IncomingMessage}. Returns `null`
 * when the body exceeds {@link FEDERATION_MAX_JSON_BYTES} or is not valid JSON.
 */
async function readJsonLimited<T>(response: IncomingMessage): Promise<T | null> {
  const buffer = await readBodyLimited(response, FEDERATION_MAX_JSON_BYTES);
  if (!buffer || buffer.length === 0) return null;
  try {
    return JSON.parse(buffer.toString('utf-8')) as T;
  } catch {
    return null;
  }
}

// System user ID for federated avatar ownership
const FEDERATION_SYSTEM_USER = '__federation__';

function normalizeFediverseHandle(handle: string): string | null {
  const cleaned = handle.trim().replace(/^acct:/i, '').replace(/^@/, '');
  const atIndex = cleaned.indexOf('@');
  if (atIndex <= 0 || atIndex === cleaned.length - 1) return null;

  const localPart = cleaned.substring(0, atIndex).toLowerCase();
  const domain = cleaned.substring(atIndex + 1).toLowerCase();
  if (!localPart || !domain) return null;

  return `${localPart}@${domain}`;
}

function domainFromHandle(handle: string): string | null {
  const atIndex = handle.indexOf('@');
  if (atIndex === -1 || atIndex === handle.length - 1) return null;
  return handle.substring(atIndex + 1).toLowerCase();
}

/**
 * Actor URIs (or, when no actorUri is known yet, lowercased handles) currently
 * mid-refresh. Prevents two concurrent background refreshes of the same actor.
 */
const _refreshInFlight = new Set<string>();

/**
 * Last time a background refresh was *attempted* for a given key, used with
 * {@link REFRESH_MIN_INTERVAL_MS} to throttle repeated attempts.
 */
const _lastRefreshAttemptAt = new Map<string, number>();

/**
 * User ids whose avatar is currently mid-download via
 * {@link FederationService.scheduleAvatarRefresh}. Prevents two concurrent
 * background avatar downloads for the same user (e.g. a burst of PUT
 * /users/resolve calls).
 */
const _avatarRefreshInFlight = new Set<string>();

/**
 * Last time an avatar download was *attempted* for a given user id, used with
 * {@link AVATAR_REFRESH_MIN_INTERVAL_MS} to coalesce in-process bursts. The
 * persisted `federation.lastAvatarFetchedAt` remains the cross-restart authority.
 */
const _lastAvatarAttemptAt = new Map<string, number>();

/**
 * Check if a string looks like a fediverse handle (@user@domain or user@domain).
 */
export function isFediverseHandle(query: string): boolean {
  return FEDIVERSE_HANDLE_REGEX.test(query.trim());
}

// ============================================================
// HTTP Signature Signing
// ============================================================

/** Mongoose model for the instance key pair (lazy-created collection). */
const keyPairSchema = new mongoose.Schema({
  keyId: { type: String, required: true, unique: true },
  publicKeyPem: { type: String, required: true },
  privateKeyPem: { type: String, required: true },
}, { timestamps: true });

const FederationKeyPair = mongoose.models.FederationKeyPair
  || mongoose.model('FederationKeyPair', keyPairSchema, 'federation_keypairs');

interface KeyPairDoc {
  keyId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

/** The public half of a key pair — safe to return over the wire. */
export interface PublicKeyDoc {
  keyId: string;
  publicKeyPem: string;
}

interface WebFingerResolution {
  actorUri: string;
  subjectAcct?: string;
}

const _keyPairCache = new Map<string, KeyPairDoc>();

/**
 * Compose the canonical `#main-key` keyId for a (username, domain) pair.
 *
 * The keyId is the single identity coordinate for a federation key: it embeds
 * BOTH the actor username and the serving domain, so a key minted for
 * `bob@mention.earth` (`https://mention.earth/ap/users/bob#main-key`) is
 * distinct from `bob` on oxy.so. The in-memory cache and the unique `keyId`
 * index in Mongo therefore enforce "one key pair per (username, domain)"
 * automatically — no separate compound field is required.
 */
function composeUserKeyId(username: string, domain: string): string {
  return `https://${domain}/ap/users/${username}#main-key`;
}

/** Compose the instance-actor keyId for a domain. */
function composeInstanceKeyId(domain: string): string {
  return `https://${domain}/ap/users/instance#main-key`;
}

/**
 * Get or create an RSA key pair for the given keyId.
 * Generated once per identity, stored in MongoDB, cached in memory.
 */
async function getOrCreateKeyPair(keyId: string): Promise<KeyPairDoc> {
  const cached = _keyPairCache.get(keyId);
  if (cached) return cached;

  const existing = await FederationKeyPair.findOne({ keyId }).lean() as KeyPairDoc | null;
  if (existing) {
    _keyPairCache.set(keyId, existing);
    return existing;
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const doc = await FederationKeyPair.create({
    keyId,
    publicKeyPem: publicKey,
    privateKeyPem: privateKey,
  });

  const result = { keyId: doc.keyId, publicKeyPem: doc.publicKeyPem, privateKeyPem: doc.privateKeyPem };
  _keyPairCache.set(keyId, result);
  return result;
}

/**
 * Get or create the instance-level key pair for a domain.
 * Defaults to Oxy's own federation domain ({@link AP_DOMAIN}) for backward
 * compatibility with Oxy's own instance actor and signed fetches.
 */
async function getInstanceKeyPair(domain: string = AP_DOMAIN): Promise<KeyPairDoc> {
  return getOrCreateKeyPair(composeInstanceKeyId(domain));
}

/**
 * Get or create a per-user key pair scoped to a domain.
 *
 * The key material is keyed by the full keyId (which embeds the domain), so a
 * single username maps to a DISTINCT key per domain. Defaults to Oxy's own
 * federation domain ({@link AP_DOMAIN}) for backward compatibility with Oxy's
 * own actor endpoints and managed accounts.
 */
export async function getUserKeyPair(username: string, domain: string = AP_DOMAIN): Promise<KeyPairDoc> {
  const normalizedUsername = username.trim().toLowerCase();
  return getOrCreateKeyPair(composeUserKeyId(normalizedUsername, domain));
}

/**
 * Return the PUBLIC half of an existing key pair for a keyId, or null if no key
 * pair exists for it. Never auto-creates and never exposes the private key —
 * used by the public-key endpoint and by callers that only need to publish a
 * `publicKey` block. To create a key on demand, use {@link getUserKeyPair} /
 * {@link getInstanceKeyPair}.
 */
export async function getPublicKeyForKeyId(keyId: string): Promise<PublicKeyDoc | null> {
  const cached = _keyPairCache.get(keyId);
  if (cached) {
    return { keyId: cached.keyId, publicKeyPem: cached.publicKeyPem };
  }

  const existing = await FederationKeyPair.findOne({ keyId }).lean() as KeyPairDoc | null;
  if (!existing) return null;

  _keyPairCache.set(keyId, existing);
  return { keyId: existing.keyId, publicKeyPem: existing.publicKeyPem };
}

/**
 * Get or create the public half of a domain-scoped USER key pair.
 *
 * Used by the `/federation/public-key/:username` endpoint so Mention can
 * publish a spec-compliant `publicKey` block whose `id`/`owner` live on its own
 * domain — WITHOUT ever receiving the private key. Creation is intentional here:
 * the first publish of an actor mints its key, mirroring how Oxy's own actor
 * endpoints lazily create keys.
 */
export async function getUserPublicKey(username: string, domain: string = AP_DOMAIN): Promise<PublicKeyDoc> {
  const keyPair = await getUserKeyPair(username, domain);
  return { keyId: keyPair.keyId, publicKeyPem: keyPair.publicKeyPem };
}

/**
 * Sign an HTTP-Signature signing string with the private key identified by
 * `keyId`. The private key NEVER leaves this process — only the base64
 * signature is returned. The key pair MUST already exist (callers publish the
 * public key first via {@link getUserPublicKey} / the actor endpoints); this
 * does NOT auto-create a key, so a sign request for an unknown keyId returns
 * null and the route surfaces a 404.
 *
 * @returns The base64 RSA-SHA256 signature, or null if no key pair exists.
 */
export async function signWithKeyId(keyId: string, signingString: string): Promise<string | null> {
  const cached = _keyPairCache.get(keyId);
  let keyPair: KeyPairDoc | null = cached ?? null;

  if (!keyPair) {
    keyPair = await FederationKeyPair.findOne({ keyId }).lean() as KeyPairDoc | null;
    if (keyPair) _keyPairCache.set(keyId, keyPair);
  }

  if (!keyPair) return null;

  const signer = crypto.createSign('sha256');
  signer.update(signingString);
  signer.end();
  return signer.sign(keyPair.privateKeyPem, 'base64');
}

/**
 * Fetch a URL with HTTP Signature authentication.
 * Required by servers that enforce authorized fetch (e.g., Threads).
 *
 * Follows redirects manually (bounded) and re-signs each hop — an HTTP
 * signature is bound to the `(request-target)` / `host` of one specific URL.
 * `safeFetch` cannot do this when it follows redirects internally.
 */
const SIGNED_FETCH_MAX_REDIRECTS = 3;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

async function signedFetch(url: string, accept: string): Promise<SafeFetchResult | null> {
  const keyPair = await getInstanceKeyPair();
  const signWithInstanceKey = async (_keyId: string, signingString: string): Promise<string> => {
    const signer = crypto.createSign('sha256');
    signer.update(signingString);
    signer.end();
    return signer.sign(keyPair.privateKeyPem, 'base64');
  };

  const fetchFollowingRedirects = async (initialUrl: string, signed: boolean): Promise<SafeFetchResult | null> => {
    let currentUrl = initialUrl;
    for (let hop = 0; hop <= SIGNED_FETCH_MAX_REDIRECTS; hop++) {
      const sigHeaders = signed
        ? await signRequest(signWithInstanceKey, keyPair.keyId, 'GET', currentUrl)
        : {};
      const res = await safeFederationFetch(currentUrl, {
        headers: {
          Accept: accept,
          'User-Agent': USER_AGENT,
          ...sigHeaders,
        },
        timeoutMs: FEDERATION_FETCH_TIMEOUT_MS,
        maxRedirects: 0,
      });
      if (!res) return null;
      if (!REDIRECT_STATUS_CODES.has(res.status)) {
        return res;
      }
      const location = res.headers.location;
      if (hop === SIGNED_FETCH_MAX_REDIRECTS || !location) {
        return res;
      }
      res.response.destroy();
      try {
        currentUrl = new URL(location, currentUrl).toString();
      } catch {
        return null;
      }
    }
    return null;
  };

  const res = await fetchFollowingRedirects(url, true);
  if (!res) return null;

  // Remote 5xx with a signature often means the server could not verify our keyId;
  // retry unsigned for public resources (same fallback as @oxyhq/federation/node).
  if (res.status >= 500) {
    logger.info(`[Federation] signedFetch got ${res.status} for ${url}, retrying unsigned`);
    res.response.destroy();
    return fetchFollowingRedirects(url, false);
  }

  if (res.status === 401 || res.status === 403) {
    logger.warn(
      `[Federation] signedFetch got ${res.status} for ${url} — remote rejected our HTTP signature`,
    );
  }

  return res;
}

/**
 * Inputs to {@link buildActor}. When `username` is null the actor is the
 * instance (`Application`) actor; otherwise it is a per-user (`Person`) actor.
 */
interface BuildActorOptions {
  domain: string;
  username: string | null;
  publicKeyPem: string;
  keyId: string;
  name: string;
  summary?: string;
  avatar?: string;
  /** Account graph kind → ActivityPub actor type (per-user actors only). */
  kind?: AccountKind;
}

/**
 * Map an account `kind` to its ActivityPub actor `type`. A personal account is a
 * `Person`; organizations/projects/bots map to the corresponding AP actor types
 * so remote servers render them appropriately.
 */
function actorTypeForKind(kind: AccountKind | undefined): string {
  switch (kind) {
    case 'organization':
      return 'Organization';
    case 'project':
      return 'Group';
    case 'bot':
      return 'Service';
    default:
      return 'Person';
  }
}

/**
 * Single canonical builder for both the instance and per-user ActivityPub
 * actor documents. Every host-bearing field — `id`, `publicKey.id`,
 * `publicKey.owner`, `inbox`, `outbox`, `followers`, `following`, `url`, and
 * `endpoints.sharedInbox` — is derived from ONE `domain` argument so the actor
 * shape can never drift across a split set of hosts. Reducing the two actor
 * functions to this one builder is what guarantees a self-consistent actor.
 */
function buildActor(opts: BuildActorOptions): Record<string, unknown> {
  const { domain, username, publicKeyPem, keyId, name, summary, avatar, kind } = opts;
  const base = `https://${domain}/ap`;

  if (username === null) {
    const actorUrl = `${base}/users/instance`;
    return {
      '@context': [
        'https://www.w3.org/ns/activitystreams',
        'https://w3id.org/security/v1',
      ],
      id: actorUrl,
      type: 'Application',
      preferredUsername: 'instance',
      name,
      summary: summary ?? '',
      url: `https://${domain}`,
      inbox: `${actorUrl}/inbox`,
      outbox: `${actorUrl}/outbox`,
      endpoints: { sharedInbox: `${base}/inbox` },
      publicKey: {
        id: keyId,
        owner: actorUrl,
        publicKeyPem,
      },
    };
  }

  const actorUrl = `${base}/users/${username}`;
  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1',
    ],
    id: actorUrl,
    type: actorTypeForKind(kind),
    preferredUsername: username,
    name,
    summary: summary ?? '',
    url: `https://${domain}/@${username}`,
    inbox: `${actorUrl}/inbox`,
    outbox: `${actorUrl}/outbox`,
    followers: `${actorUrl}/followers`,
    following: `${actorUrl}/following`,
    endpoints: { sharedInbox: `${base}/inbox` },
    icon: avatar ? {
      type: 'Image',
      mediaType: 'image/png',
      url: avatar,
    } : undefined,
    publicKey: {
      id: keyId,
      owner: actorUrl,
      publicKeyPem,
    },
  };
}

/**
 * Returns the instance actor JSON-LD document for HTTP Signature key
 * verification. Self-consistent on the given `domain` (defaults to Oxy's own
 * federation domain {@link AP_DOMAIN}).
 */
export async function getInstanceActor(domain: string = AP_DOMAIN): Promise<Record<string, unknown>> {
  const keyPair = await getInstanceKeyPair(domain);
  return buildActor({
    domain,
    username: null,
    publicKeyPem: keyPair.publicKeyPem,
    keyId: keyPair.keyId,
    name: domain,
  });
}

/**
 * Resolve a local user's avatar to a publicly-fetchable absolute URL for the
 * federated actor document's `icon`.
 *
 * - Already-absolute URLs (e.g. a remote avatar mirrored verbatim) pass through.
 * - A stored Oxy file id resolves to the public CDN URL of its `thumb` variant
 *   via the asset service, so remote servers fetch from `cloud.oxy.so` — never a
 *   raw S3 URL and never the previous broken `/files/<id>/variant/thumb` scheme.
 * - Anything that cannot be resolved publicly (missing/private avatar) is
 *   omitted rather than advertising an unreachable URL.
 */
async function resolveActorAvatarUrl(avatar: unknown): Promise<string | undefined> {
  if (typeof avatar !== 'string' || avatar.length === 0) {
    return undefined;
  }
  if (avatar.startsWith('http')) {
    return avatar;
  }

  try {
    const assetService = getAssetService();
    const file = await assetService.getFile(avatar);
    if (!file) {
      return undefined;
    }
    const cdnUrl = await assetService.getPublicCdnUrl(file, 'thumb');
    return cdnUrl ?? undefined;
  } catch (error) {
    logger.warn('Failed to resolve federated actor avatar URL', {
      avatar,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Returns a per-user actor JSON-LD document, self-consistent on `domain`
 * (defaults to Oxy's own federation domain {@link AP_DOMAIN}).
 *
 * The `name` field is the canonical composed display name (identity contract).
 * `getUserActor` is called with lean User docs (no virtuals), so the display
 * name is composed here via the shared {@link composeDisplayName} rules rather
 * than read from the (absent) virtual.
 */
export async function getUserActor(user: IUser, domain: string = AP_DOMAIN): Promise<Record<string, unknown> | null> {
  if (!user?.username) return null;
  // Canonicalize before key lookup and actor URL assembly so `id`/`publicKey.owner`
  // always match `publicKey.id` (getUserKeyPair lowercases internally).
  const username = user.username.split('@')[0].trim().toLowerCase();
  const keyPair = await getUserKeyPair(username, domain);

  // An ActivityPub actor's `name` field requires a non-empty string. The API no
  // longer synthesizes a display name, so fall back to the handle (`username` is
  // guaranteed here — `getUserActor` returns null above when it is absent).
  const displayName = composeDisplayName({ name: user.name }) ?? username;

  const avatar = await resolveActorAvatarUrl(user.avatar);

  return buildActor({
    domain,
    username,
    publicKeyPem: keyPair.publicKeyPem,
    keyId: keyPair.keyId,
    name: displayName,
    summary: user.bio || user.description || '',
    avatar,
    kind: user.kind,
  });
}

// ============================================================
// Asset Service (lazy init)
// ============================================================

let _assetService: AssetService | null = null;

/**
 * Required env vars for federated avatar storage on S3.
 * These are validated at boot by `validateRequiredEnvVars()` in `config/env.ts`,
 * but we re-assert here so the failure mode is a loud throw at the call site
 * (with the relevant variable name) rather than an opaque AWS "missing credentials" error.
 */
function getAssetService(): AssetService {
  if (!_assetService) {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const bucketName = process.env.AWS_S3_BUCKET;

    if (!accessKeyId) {
      throw new Error('AWS_ACCESS_KEY_ID is required for the federation service');
    }
    if (!secretAccessKey) {
      throw new Error('AWS_SECRET_ACCESS_KEY is required for the federation service');
    }
    if (!bucketName) {
      throw new Error('AWS_S3_BUCKET is required for the federation service');
    }

    const s3 = createS3Service({
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId,
      secretAccessKey,
      bucketName,
      endpointUrl: process.env.AWS_ENDPOINT_URL,
    });
    _assetService = new AssetService(s3);
  }
  return _assetService;
}

// ============================================================
// Federation Service
// ============================================================

class FederationService {
  private async storedAvatarExists(fileId: unknown): Promise<boolean> {
    if (typeof fileId !== 'string' || !fileId || fileId.startsWith('http')) {
      return false;
    }

    try {
      return await getAssetService().fileContentExists(fileId);
    } catch (err) {
      logger.warn(
        `Failed checking stored federated avatar ${fileId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  /**
   * Resolve a WebFinger acct to an ActivityPub actor URI.
   * @param acct - e.g. "alice@mastodon.social" or "@alice@mastodon.social"
   */
  async resolveWebFingerResource(acct: string): Promise<WebFingerResolution | null> {
    const normalizedAcct = normalizeFediverseHandle(acct);
    if (!normalizedAcct) return null;

    const domain = domainFromHandle(normalizedAcct);
    if (!domain) return null;

    const resource = `acct:${normalizedAcct}`;
    const url = `https://${domain}/.well-known/webfinger?resource=${encodeURIComponent(resource)}`;

    try {
      const res = await safeFederationFetch(url, {
        headers: { Accept: 'application/jrd+json, application/json' },
        timeoutMs: FEDERATION_FETCH_TIMEOUT_MS,
      });
      if (!res || res.status < 200 || res.status >= 300) {
        res?.response.destroy();
        return null;
      }

      const data = await readJsonLimited<{
        subject?: string;
        links?: Array<{ rel?: string; type?: string; href?: string }>;
      }>(res.response);
      if (!data) return null;

      const link = data.links?.find(
        (l) => l.rel === 'self' && l.type && AP_ACCEPT_TYPES.includes(l.type),
      );
      if (!link?.href) return null;

      const subjectAcct = typeof data.subject === 'string'
        ? normalizeFediverseHandle(data.subject) || undefined
        : undefined;

      return {
        actorUri: link.href,
        subjectAcct,
      };
    } catch (err) {
      logger.warn(`WebFinger resolution failed for ${acct}: ${err}`);
      return null;
    }
  }

  /**
   * Resolve a WebFinger acct to an ActivityPub actor URI.
   * @param acct - e.g. "alice@mastodon.social" or "@alice@mastodon.social"
   */
  async resolveWebFinger(acct: string): Promise<string | null> {
    const resolution = await this.resolveWebFingerResource(acct);
    return resolution?.actorUri || null;
  }

  /**
   * Returns the acct that can be safely used as the canonical username for a
   * WebFinger result. A remote WebFinger endpoint may advertise `subject` as a
   * canonical alias (for example `user@www.example` -> `user@example`), but that
   * claimed account is controlled by a different domain. Before storing it,
   * resolve the claimed account through its own domain and require it to point
   * back to the same actor URI — otherwise an attacker domain could spoof an
   * identity on a trusted domain.
   */
  private async verifiedAccountForResolution(
    requestedAcct: string,
    resolution: WebFingerResolution,
  ): Promise<string> {
    const requested = normalizeFediverseHandle(requestedAcct);
    const subject = resolution.subjectAcct ? normalizeFediverseHandle(resolution.subjectAcct) : null;
    if (!requested || !subject || subject === requested) {
      return requested || requestedAcct.toLowerCase();
    }

    try {
      const subjectResolution = await this.resolveWebFingerResource(subject);
      if (subjectResolution?.actorUri === resolution.actorUri) {
        return subject;
      }

      logger.warn(
        `Ignoring unverified WebFinger subject ${subject} for ${requested}: `
          + `expected actor ${resolution.actorUri}, got ${subjectResolution?.actorUri || 'none'}`,
      );
    } catch (err) {
      logger.warn(
        `Failed verifying WebFinger subject ${subject} for ${requested}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return requested;
  }

  /**
   * Fetch an ActivityPub actor by URI and extract user-profile fields.
   * Uses HTTP Signature for servers that enforce authorized fetch.
   */
  async fetchActorProfile(actorUri: string, acctHint?: string): Promise<{
    actorUri: string;
    domain: string;
    username: string;
    displayName: string;
    avatarUrl?: string;
    bio?: string;
  } | null> {
    try {
      const res = await signedFetch(actorUri, AP_ACCEPT_TYPES[0]);
      if (!res || res.status < 200 || res.status >= 300) {
        res?.response.destroy();
        return null;
      }

      const actor = await readJsonLimited<Record<string, unknown>>(res.response);
      if (!actor || typeof actor.id !== 'string' || !actor.inbox) return null;

      // The actor's `id` is attacker-controlled by the actor host; it must be a
      // public https URL before we trust its host as the canonical domain.
      let actorHost: string;
      try {
        const actorIdUrl = new URL(actor.id);
        if (actorIdUrl.protocol !== 'https:') return null;
        actorHost = actorIdUrl.hostname.toLowerCase();
      } catch {
        return null;
      }
      const username = (actor.preferredUsername as string) || (actor.name as string) || 'unknown';
      const actorWebfinger = typeof actor.webfinger === 'string'
        ? normalizeFediverseHandle(actor.webfinger)
        : null;
      const hintedAcct = acctHint ? normalizeFediverseHandle(acctHint) : null;
      // The handle used for storage must come from the WebFinger resource we
      // resolved and verified before fetching this actor. Actor documents are
      // attacker-controlled by the actor host, so their optional `webfinger`
      // field is only a fallback when no trusted hint is available.
      const acct = hintedAcct || actorWebfinger || `${username.toLowerCase()}@${actorHost}`;
      const domain = domainFromHandle(acct) || actorHost;

      return {
        actorUri: actor.id,
        domain,
        username: acct,
        displayName: decodeHtmlEntities((actor.name as string) || username),
        avatarUrl: (actor.icon as Record<string, unknown>)?.url as string | undefined,
        bio: decodeHtmlEntities((actor.summary as string)?.replace(/<[^>]*>/g, '') || ''),
      };
    } catch (err) {
      logger.warn(`Failed to fetch actor profile ${actorUri}: ${err}`);
      return null;
    }
  }

  /**
   * Download a remote avatar image, upload it to Oxy Cloud, and return the file
   * ID along with the validators the host advertised.
   *
   * Conditional requests: when `conditional.etag` / `conditional.lastModified`
   * are supplied (from a previous fetch), they are replayed as `If-None-Match` /
   * `If-Modified-Since`. A `304 Not Modified` response means the stored file is
   * still current — we skip the download+upload round-trip entirely and signal
   * `notModified: true` so the caller can still advance its throttle clock.
   *
   * If the user already has an avatar file, the old one is deleted before the
   * new upload (only when we actually downloaded a new image).
   *
   * @param avatarUrl              - Remote avatar URL to fetch.
   * @param existingAvatarFileId   - Current stored file id (deleted on replace).
   * @param conditional            - Stored validators to replay as conditional headers.
   */
  async downloadAndStoreAvatar(
    avatarUrl: string,
    existingAvatarFileId?: string,
    conditional?: { etag?: string; lastModified?: string },
    ownerUserId = FEDERATION_SYSTEM_USER,
  ): Promise<{ fileId: string | null; etag?: string; lastModified?: string; notModified: boolean }> {
    try {
      const requestHeaders: Record<string, string> = { 'User-Agent': USER_AGENT };
      if (conditional?.etag) {
        requestHeaders['If-None-Match'] = conditional.etag;
      }
      if (conditional?.lastModified) {
        requestHeaders['If-Modified-Since'] = conditional.lastModified;
      }

      const res = await safeFederationFetch(avatarUrl, {
        headers: requestHeaders,
        timeoutMs: FEDERATION_AVATAR_FETCH_TIMEOUT_MS,
      });
      if (!res) {
        return { fileId: null, notModified: false };
      }

      // 304: the host confirms the remote bytes are unchanged. This only means
      // our local copy is usable if the referenced asset still exists in S3.
      // If the DB record points to a missing object, retry without validators
      // so the remote sends the body and we can repair the stored file id.
      if (res.status === 304) {
        res.response.destroy();
        if (await this.storedAvatarExists(existingAvatarFileId)) {
          return {
            fileId: null,
            etag: conditional?.etag,
            lastModified: conditional?.lastModified,
            notModified: true,
          };
        }

        logger.warn(`Remote avatar returned 304 but stored file is missing for ${avatarUrl}; retrying full download`);
        if (conditional?.etag || conditional?.lastModified) {
          return this.downloadAndStoreAvatar(avatarUrl, existingAvatarFileId, undefined, ownerUserId);
        }

        return {
          fileId: null,
          etag: conditional?.etag,
          lastModified: conditional?.lastModified,
          notModified: false,
        };
      }

      if (res.status < 200 || res.status >= 300) {
        res.response.destroy();
        logger.warn(`Avatar download failed: HTTP ${res.status} for ${avatarUrl}`);
        return { fileId: null, notModified: false };
      }

      const headerValue = (name: string): string | undefined => {
        const value = res.headers[name];
        return Array.isArray(value) ? value[0] : value || undefined;
      };
      const etag = headerValue('etag');
      const lastModified = headerValue('last-modified');

      // Sanitize content-type: strip parameters (e.g. "image/jpeg; charset=utf-8" → "image/jpeg")
      const rawContentType = headerValue('content-type') || 'image/png';
      const contentType = rawContentType.split(';')[0].trim().toLowerCase();

      // Accept image/* and common binary types that CDNs return for images
      if (!contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
        res.response.destroy();
        logger.warn(`Avatar download skipped: non-image content-type "${rawContentType}" for ${avatarUrl}`);
        return { fileId: null, etag, lastModified, notModified: false };
      }

      // Enforce a hard byte cap; safeFetch does NOT bound the response body. A
      // pre-check on the advertised content-length drops an oversized body
      // before reading a single byte, and the streaming reader caps anything
      // the header understated. An oversized body returns null and is dropped.
      const advertisedLength = headerValue('content-length');
      if (advertisedLength !== undefined && Number(advertisedLength) > FEDERATION_MAX_AVATAR_BYTES) {
        res.response.destroy();
        logger.warn(`Avatar download skipped: content-length ${advertisedLength} exceeds cap for ${avatarUrl}`);
        return { fileId: null, etag, lastModified, notModified: false };
      }

      const buffer = await readBodyLimited(res.response, FEDERATION_MAX_AVATAR_BYTES);
      if (!buffer || buffer.length === 0) {
        return { fileId: null, etag, lastModified, notModified: false };
      }

      // For application/octet-stream, infer MIME from URL extension or default to png
      let mime = contentType;
      if (mime === 'application/octet-stream') {
        const urlLower = avatarUrl.toLowerCase();
        if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg')) mime = 'image/jpeg';
        else if (urlLower.endsWith('.webp')) mime = 'image/webp';
        else if (urlLower.endsWith('.gif')) mime = 'image/gif';
        else mime = 'image/png';
      }

      const assetService = getAssetService();

      // Determine extension from sanitized content type
      const extMap: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      const ext = extMap[mime] || 'png';
      const filename = `federated-avatar-${crypto.randomBytes(8).toString('hex')}.${ext}`;

      const file = await assetService.uploadFileDirect(
        ownerUserId,
        buffer,
        mime,
        filename,
        'public',
        {
          source: 'federation',
          role: 'avatar',
          remoteUrl: avatarUrl,
        },
      );

      const fileId = file._id.toString();

      // Delete the replaced avatar only after the new durable file is present.
      // If dedupe returned the same file, keep it.
      if (
        existingAvatarFileId &&
        !existingAvatarFileId.startsWith('http') &&
        existingAvatarFileId !== fileId
      ) {
        try {
          await assetService.deleteFile(existingAvatarFileId, true);
        } catch {
          // Old file may already be gone — not critical
        }
      }

      return { fileId, etag, lastModified, notModified: false };
    } catch (err) {
      logger.warn(`Failed to download/store federated avatar: ${err}`);
      return { fileId: null, notModified: false };
    }
  }

  /**
   * Full pipeline: resolve a fediverse handle to an Oxy user.
   *
   * Fast + eventually-fresh (Bluesky-style):
   * 1. If a cached federated user exists, RETURN IT IMMEDIATELY — never block
   *    on remote I/O when we already have a row. If that row is stale (older
   *    than {@link STALE_MS}) or still has a raw-URL avatar that needs
   *    downloading, kick off a fire-and-forget background refresh that replaces
   *    avatar/name/bio in place, but still return the cached record now.
   * 2. If NO cached row exists, do the first-time blocking fetch:
   *    WebFinger → fetch actor profile (HTTP Signature) → download avatar →
   *    upsert as type=federated → return.
   */
  async resolveAndUpsert(handle: string): Promise<IUser | null> {
    const cleaned = normalizeFediverseHandle(handle);
    if (!cleaned) return null;

    const domain = domainFromHandle(cleaned);
    if (!domain) return null;

    // Own-domain guard: a handle like `nate@oxy.so` is a NON-ENTITY. On Oxy's
    // own apex the only valid identity is the bare local handle `@nate`; the
    // domain-qualified form `@nate@oxy.so` must never resolve or be surfaced, so
    // it can't even look like a second representation of the same user. Return
    // null immediately — never WebFinger our own apex, never touch the DB, and
    // never upsert a `type:'federated'` shadow row.
    if (isOwnFederationDomain(domain)) {
      return null;
    }

    // Check cache: existing federated user.
    // Fediverse usernames are case-insensitive; we store them lowercased.
    const existing = await User.findOne({
      type: 'federated',
      'federation.domain': domain,
      username: cleaned.toLowerCase(),
    })
      .select('-password -refreshToken')
      .lean({ virtuals: true }) as IUser | null;

    if (existing) {
      // Archived actors (410-Gone tombstones) stay cached for follow-graph /
      // audit continuity but must not be refreshed or re-surfaced as live.
      if (existing.accountStatus === 'archived') {
        return existing;
      }

      // We have a row — never block the caller on remote I/O. Decide whether a
      // background refresh is warranted: either the record is stale, or its
      // avatar is still a raw http URL (e.g. set by PUT /users/resolve) that
      // hasn't been downloaded into an Oxy file yet.
      const isStale = !existing.updatedAt
        || Date.now() - new Date(existing.updatedAt).getTime() >= STALE_MS;
      const avatarNeedsDownload = typeof existing.avatar === 'string'
        && existing.avatar.startsWith('http');
      const avatarFileMissing = !isStale && !avatarNeedsDownload
        ? !(await this.storedAvatarExists(existing.avatar))
        : false;

      if (isStale || avatarNeedsDownload || avatarFileMissing) {
        this.scheduleBackgroundRefresh(existing, cleaned);
      }

      return existing;
    }

    // No cached row — first-time blocking fetch (the only allowed blocking case).
    const webfinger = await this.resolveWebFingerResource(cleaned);
    if (!webfinger) return null;

    const verifiedAcct = await this.verifiedAccountForResolution(cleaned, webfinger);
    const profile = await this.fetchActorProfile(webfinger.actorUri, verifiedAcct);
    if (!profile) return null;

    const setFields: Record<string, unknown> = {
      type: 'federated',
      username: profile.username,
      'name.first': cleanDisplayName(profile.displayName),
      'federation.actorUri': profile.actorUri,
      'federation.domain': profile.domain,
      'federation.lastResolvedAt': new Date(),
    };

    if (profile.bio) {
      const safeBio = sanitizePlainText(profile.bio);
      setFields.bio = safeBio;
      setFields.description = safeBio;
    }

    const user = await User.findOneAndUpdate(
      { 'federation.actorUri': profile.actorUri },
      {
        $set: setFields,
        $unset: {
          'federation.unavailableAt': '',
          'federation.unavailableReason': '',
        },
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
    )
      .select('-password -refreshToken');

    if (user) {
      logger.info(`Resolved fediverse user: ${profile.username} (${profile.actorUri})`);
    }

    if (user && profile.avatarUrl) {
      const userId = user._id.toString();
      const stored = await this.downloadAndStoreAvatar(
        profile.avatarUrl,
        undefined,
        undefined,
        userId,
      );
      if (stored.fileId) {
        const avatarFields: Record<string, unknown> = {
          avatar: stored.fileId,
          'federation.lastAvatarFetchedAt': new Date(),
        };
        if (stored.etag) avatarFields['federation.avatarETag'] = stored.etag;
        if (stored.lastModified) avatarFields['federation.avatarLastModified'] = stored.lastModified;

        await User.updateOne({ _id: user._id }, { $set: avatarFields });
        user.avatar = stored.fileId;
        if (!user.federation) user.federation = {};
        user.federation.lastAvatarFetchedAt = avatarFields['federation.lastAvatarFetchedAt'] as Date;
        if (stored.etag) user.federation.avatarETag = stored.etag;
        if (stored.lastModified) user.federation.avatarLastModified = stored.lastModified;
        userCache.invalidate(userId);
      }
    }

    return user;
  }

  /**
   * Fire-and-forget scheduler for {@link refreshFederatedUser}.
   *
   * Storm guard: a given actor is refreshed at most once concurrently
   * ({@link _refreshInFlight}) and at most once per {@link REFRESH_MIN_INTERVAL_MS}
   * ({@link _lastRefreshAttemptAt}). The refresh key is the actor URI when known,
   * otherwise the lowercased handle. This method NEVER awaits and NEVER throws —
   * a rejected refresh is caught and logged so it can't surface as an unhandled
   * rejection or crash the process.
   */
  private scheduleBackgroundRefresh(existing: IUser, handle: string): void {
    if (existing.accountStatus === 'archived') {
      return;
    }

    const key = existing.federation?.actorUri || handle.toLowerCase();

    if (_refreshInFlight.has(key)) return;

    const lastAttempt = _lastRefreshAttemptAt.get(key);
    if (lastAttempt !== undefined && Date.now() - lastAttempt < REFRESH_MIN_INTERVAL_MS) {
      return;
    }

    _refreshInFlight.add(key);
    _lastRefreshAttemptAt.set(key, Date.now());

    void this.refreshFederatedUser(existing, handle)
      .catch((err) => {
        logger.warn(
          `Background federated refresh failed for ${key}: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        _refreshInFlight.delete(key);
      });
  }

  /**
   * Fire-and-forget scheduler that moves a remote avatar download OFF the
   * request path (used by PUT /users/resolve). The caller upserts the user and
   * returns immediately; this replaces the user's `avatar` file id once the
   * download completes and invalidates the user cache.
   *
   * Throttle: at most one download per user concurrently
   * ({@link _avatarRefreshInFlight}) and at most one per
   * {@link AVATAR_REFRESH_MIN_INTERVAL_MS} per process
   * ({@link _lastAvatarAttemptAt}). The persisted
   * `federation.lastAvatarFetchedAt`, re-read inside {@link downloadAvatarForUser},
   * is the cross-restart authority. This method NEVER awaits and NEVER throws —
   * a rejection is caught and logged so it can't surface as an unhandled
   * rejection.
   *
   * @param userId               - The upserted user's id (resolved fresh inside).
   * @param remoteAvatarUrl      - The http(s) avatar URL to download.
   * @param existingAvatarFileId - Current stored avatar file id (deleted on replace).
   * @param opts.force           - When true (a `refresh`/`forceAvatarRefresh`
   *                               request), re-download even if a stored file id
   *                               already exists — still subject to the throttle.
   */
  scheduleAvatarRefresh(
    userId: string,
    remoteAvatarUrl: string,
    existingAvatarFileId: string | undefined,
    opts: { force: boolean },
  ): void {
    if (_avatarRefreshInFlight.has(userId)) return;

    const lastAttempt = _lastAvatarAttemptAt.get(userId);
    if (lastAttempt !== undefined && Date.now() - lastAttempt < AVATAR_REFRESH_MIN_INTERVAL_MS) {
      return;
    }

    _avatarRefreshInFlight.add(userId);
    _lastAvatarAttemptAt.set(userId, Date.now());

    void this.downloadAvatarForUser(userId, remoteAvatarUrl, existingAvatarFileId, opts)
      .catch((err) => {
        logger.warn(
          `Background avatar refresh failed for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      })
      .finally(() => {
        _avatarRefreshInFlight.delete(userId);
      });
  }

  /**
   * Background worker for {@link scheduleAvatarRefresh}. Resolves the user fresh
   * from its id so it reads the authoritative persisted throttle clock and
   * conditional-request validators, downloads the avatar (conditionally), and
   * persists the result. Wraps its whole body so a rejection can never escape
   * the fire-and-forget caller — all failures are logged.
   */
  private async downloadAvatarForUser(
    userId: string,
    remoteAvatarUrl: string,
    existingAvatarFileId: string | undefined,
    opts: { force: boolean },
  ): Promise<void> {
    try {
      const user = await User.findById(userId)
        .select('avatar federation')
        .lean() as Pick<IUser, '_id' | 'avatar' | 'federation'> | null;
      if (!user) {
        logger.warn(`Background avatar refresh: user ${userId} not found`);
        return;
      }

      const storedAvatar = typeof user.avatar === 'string' ? user.avatar : existingAvatarFileId;
      const alreadyHasFileId = typeof storedAvatar === 'string'
        && storedAvatar.length > 0
        && !storedAvatar.startsWith('http');

      // Persisted authority: skip a forced re-download inside the throttle window.
      // The in-memory guard in scheduleAvatarRefresh handles the common in-process
      // burst; this catches forced refreshes across process restarts.
      const lastFetched = user.federation?.lastAvatarFetchedAt;
      if (
        opts.force
        && alreadyHasFileId
        && lastFetched
        && Date.now() - new Date(lastFetched).getTime() < AVATAR_REFRESH_MIN_INTERVAL_MS
      ) {
        return;
      }

      // Without a force flag, never re-download once we hold a stored file id.
      if (!opts.force && alreadyHasFileId) {
        return;
      }

      const stored = await this.downloadAndStoreAvatar(remoteAvatarUrl, storedAvatar, {
        etag: user.federation?.avatarETag,
        lastModified: user.federation?.avatarLastModified,
      }, userId);

      const setFields: Record<string, unknown> = {
        'federation.lastAvatarFetchedAt': new Date(),
      };

      if (stored.notModified) {
        // Host says our copy is current — only advance the fetch clock.
        await User.updateOne({ _id: userId }, { $set: setFields });
        userCache.invalidate(userId);
        return;
      }

      if (!stored.fileId) {
        // Download failed — keep the existing avatar, but advance the clock so a
        // forced refresh can't hammer a broken remote every request.
        await User.updateOne({ _id: userId }, { $set: setFields });
        userCache.invalidate(userId);
        logger.warn(`Background avatar refresh: download failed for ${userId} (keeping existing)`);
        return;
      }

      setFields.avatar = stored.fileId;
      if (stored.etag) setFields['federation.avatarETag'] = stored.etag;
      if (stored.lastModified) setFields['federation.avatarLastModified'] = stored.lastModified;

      await User.updateOne({ _id: userId }, { $set: setFields });

      // CRITICAL: every path that mutates user state must invalidate the cache,
      // otherwise getUserBySession serves stale in-memory data and silently
      // reverts this update.
      userCache.invalidate(userId);

      logger.info(`Background-refreshed federated avatar for ${userId}`);
    } catch (err) {
      // Defensive: this worker must never throw out of the fire-and-forget
      // caller. The scheduler also has a .catch, but we log here with context too.
      logger.error(
        `Background avatar refresh threw for ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Re-fetch a federated actor's avatar/name/bio and update the cached Oxy user
   * in place. Runs in the background (fire-and-forget). Wraps its whole body so
   * a rejection can never escape the caller — all failures are logged.
   *
   * @param existing - The cached federated user to refresh.
   * @param handle   - The lowercased handle, used to re-WebFinger if no actorUri.
   */
  private async refreshFederatedUser(existing: IUser, handle: string): Promise<void> {
    if (existing.accountStatus === 'archived') {
      return;
    }

    const userId = existing._id.toString();
    try {
      // Resolve the actor URI: reuse the stored one, else re-WebFinger.
      const actorUri = existing.federation?.actorUri
        || await this.resolveWebFinger(handle);
      if (!actorUri) {
        logger.warn(`Background refresh: could not resolve actor URI for ${handle}`);
        return;
      }

      const profile = await this.fetchActorProfile(actorUri, handle);
      if (!profile) {
        logger.warn(`Background refresh: actor profile fetch returned null for ${actorUri}`);
        return;
      }

      const setFields: Record<string, unknown> = {};

      if (profile.displayName) {
        setFields['name.first'] = cleanDisplayName(profile.displayName);
      }
      setFields['federation.lastResolvedAt'] = new Date();
      if (profile.bio) {
        const safeBio = sanitizePlainText(profile.bio);
        setFields.bio = safeBio;
        setFields.description = safeBio;
      }

      // Download the latest avatar and replace the old stored file, replaying any
      // stored validators as a conditional request. Only set the avatar field
      // when the download succeeded — never clobber a good avatar with null
      // because the remote fetch failed. On 304 we keep the existing file but
      // still advance the fetch clock so we don't re-attempt every request.
      if (profile.avatarUrl) {
        const existingAvatar = typeof existing.avatar === 'string' ? existing.avatar : undefined;
        const stored = await this.downloadAndStoreAvatar(profile.avatarUrl, existingAvatar, {
          etag: existing.federation?.avatarETag,
          lastModified: existing.federation?.avatarLastModified,
        }, userId);
        if (stored.notModified) {
          setFields['federation.lastAvatarFetchedAt'] = new Date();
        } else if (stored.fileId) {
          setFields.avatar = stored.fileId;
          setFields['federation.lastAvatarFetchedAt'] = new Date();
          if (stored.etag) setFields['federation.avatarETag'] = stored.etag;
          if (stored.lastModified) setFields['federation.avatarLastModified'] = stored.lastModified;
        } else {
          logger.warn(`Background refresh: avatar download failed for ${actorUri} (keeping existing)`);
        }
      }

      if (Object.keys(setFields).length === 0) {
        // Nothing new to persist; touch updatedAt so we don't re-attempt every
        // request until the next stale window.
        await User.updateOne({ _id: existing._id }, { $set: { updatedAt: new Date() } });
        userCache.invalidate(userId);
        return;
      }

      await User.updateOne(
        { _id: existing._id },
        {
          $set: setFields,
          $unset: {
            'federation.unavailableAt': '',
            'federation.unavailableReason': '',
          },
        },
      );

      // CRITICAL: every path that mutates user state must invalidate the cache,
      // otherwise getUserBySession serves stale in-memory data and silently
      // reverts this update.
      userCache.invalidate(userId);

      logger.info(
        `Background-refreshed federated user ${existing.username || handle} (${actorUri})`,
      );
    } catch (err) {
      // Defensive: refreshFederatedUser must never throw out of the
      // fire-and-forget caller. The scheduler also has a .catch, but we log here
      // with full context too.
      logger.error(
        `Background refresh threw for ${handle} (${userId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const federationService = new FederationService();
export default federationService;
