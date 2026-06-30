/**
 * `createDidWebResolver` — a {@link VerificationMethodResolver} for arbitrary
 * `did:web` subjects, backing the chain engine on multi-subject relay/ingest
 * paths (where the signer is NOT a local account but any DID that publishes a
 * DID document).
 *
 * It resolves a `did:web:<host>[:<path>]` subject to its `did.json`, fetched via
 * an INJECTED {@link NodeFetch} — Oxy passes an adapter over `@oxyhq/core/server`
 * `safeFetch` (so the SSRF/transport policy stays in core); a test passes a
 * stub. The subject's current verification keys are read from the DID document's
 * `verificationMethod[].publicKeyHex` (the active assertion methods), and the
 * engine's `isAuthorizedKey` then applies the uniform self-issued rule.
 *
 * `did:web` → URL mapping (W3C did:web):
 *  - `did:web:example.com`        → `https://example.com/.well-known/did.json`
 *  - `did:web:example.com:u:123`  → `https://example.com/u/123/did.json`
 *  - a `%3A` in the host segment is decoded to `:` (an explicit port).
 */

import { didDocumentSchema, type DidDocument } from '@oxyhq/contracts';
import type {
  ResolvedVerificationMethods,
  VerificationMethodResolver,
} from '../identity/resolver';
import { type NodeFetch, readBoundedJson } from './httpFetch';
import {
  DEFAULT_CLIENT_MAX_REDIRECTS,
  DEFAULT_CLIENT_TIMEOUT_MS,
  DEFAULT_DID_DOC_MAX_BYTES,
} from './constants';

/** Options for {@link createDidWebResolver}. */
export interface DidWebResolverOptions {
  /** Time-to-first-byte deadline for the `did.json` fetch (ms). */
  headersTimeoutMs?: number;
  /** Redirect budget for the `did.json` fetch (each re-validated by the transport). */
  maxRedirects?: number;
  /** Bounded read ceiling for the fetched `did.json`. */
  maxBytes?: number;
  /**
   * Notified when a subject cannot be resolved (mapping/fetch/parse failure).
   * `resolve` still returns `null` (the engine treats that as "no authorized
   * key") — this hook gives the failure visibility without a silent catch.
   */
  onError?: (err: unknown, subjectDid: string) => void;
}

/**
 * Map a `did:web` DID to its `did.json` URL, or `null` when `did` is not a
 * well-formed `did:web` identifier.
 */
export function didWebToUrl(did: string): string | null {
  const prefix = 'did:web:';
  if (!did.startsWith(prefix)) {
    return null;
  }
  const msi = did.slice(prefix.length);
  if (msi.length === 0) {
    return null;
  }
  const [domainPart, ...pathParts] = msi.split(':');
  const host = domainPart.replace(/%3A/gi, ':');
  if (host.length === 0 || host.includes('/')) {
    return null;
  }
  const base = `https://${host}`;
  if (pathParts.length === 0) {
    return `${base}/.well-known/did.json`;
  }
  if (pathParts.some((part) => part.length === 0)) {
    return null;
  }
  return `${base}/${pathParts.join('/')}/did.json`;
}

/**
 * Collect the subject's current verification keys from its DID document: the
 * `publicKeyHex` of every verification method referenced by `assertionMethod`
 * (the keys that may sign assertions/records), deduped. Falls back to ALL
 * `verificationMethod[]` keys when `assertionMethod` references nothing local.
 */
function collectCurrentPublicKeys(doc: DidDocument): string[] {
  const byId = new Map(doc.verificationMethod.map((vm) => [vm.id, vm.publicKeyHex] as const));
  const keys: string[] = [];
  for (const id of doc.assertionMethod) {
    const key = byId.get(id);
    if (key && !keys.includes(key)) {
      keys.push(key);
    }
  }
  if (keys.length === 0) {
    for (const vm of doc.verificationMethod) {
      if (!keys.includes(vm.publicKeyHex)) {
        keys.push(vm.publicKeyHex);
      }
    }
  }
  return keys;
}

/**
 * Build a {@link VerificationMethodResolver} that resolves `did:web` subjects via
 * the injected `fetch`. Returns `null` for any subject that is not a `did:web`
 * DID, whose `did.json` cannot be fetched, or whose document fails schema
 * validation — the engine then treats the signer as unauthorized.
 */
export function createDidWebResolver(
  fetch: NodeFetch,
  options: DidWebResolverOptions = {},
): VerificationMethodResolver {
  const headersTimeoutMs = options.headersTimeoutMs ?? DEFAULT_CLIENT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_CLIENT_MAX_REDIRECTS;
  const maxBytes = options.maxBytes ?? DEFAULT_DID_DOC_MAX_BYTES;

  return {
    async resolve(subjectDid: string): Promise<ResolvedVerificationMethods | null> {
      const url = didWebToUrl(subjectDid);
      if (!url) {
        return null;
      }
      try {
        const res = await fetch(url, { method: 'GET', headersTimeoutMs, maxRedirects });
        if (res.status < 200 || res.status >= 300) {
          res.destroy();
          return null;
        }
        const body = await readBoundedJson(res, maxBytes);
        const parsed = didDocumentSchema.safeParse(body);
        if (!parsed.success) {
          return null;
        }
        // The DID document `id` MUST match the subject we asked for — a document
        // served at the subject's URL but claiming another id is not authoritative.
        if (parsed.data.id !== subjectDid) {
          return null;
        }
        return { currentPublicKeys: collectCurrentPublicKeys(parsed.data) };
      } catch (err) {
        options.onError?.(err, subjectDid);
        return null;
      }
    },
  };
}
