/**
 * ActivityPub URI parsing + per-instance domain policy.
 *
 * `extractActorUriFromActivityId` is pure and domain-agnostic. The blocked-domain
 * check and the local-post-id extractor are DOMAIN-SCOPED — they depend on which
 * hosts an app mints its own URIs under and which identity apex publishes its own
 * users — so they come from a per-instance {@link createDomainPolicy} rather than
 * a module-level constant.
 */

/** Path segments that typically separate an actor path from a post ID in ActivityPub URIs. */
const POST_PATH_SEGMENTS = new Set(['statuses', 'posts', 'notes', 'objects', 'activities']);

/** Lowercase a host and strip a leading `www.` so `mention.earth` and `www.mention.earth` match. */
function canonicalDomainHost(domain: string): string {
  const d = domain.trim().toLowerCase();
  return d.startsWith('www.') ? d.slice(4) : d;
}

/**
 * Given an ActivityPub activity/object ID (URL), extract the actor URI by
 * trimming everything from the first recognised post-path segment onward.
 *
 * e.g. "https://mastodon.social/users/alice/statuses/12345"
 *    → "https://mastodon.social/users/alice"
 *
 * Returns null when the URL is malformed or no post-path segment is found.
 */
export function extractActorUriFromActivityId(activityId: string): string | null {
  try {
    const url = new URL(activityId);
    const segments = url.pathname.split('/').filter(Boolean);
    const statusIdx = segments.findIndex((s) => POST_PATH_SEGMENTS.has(s));
    if (statusIdx < 1) return null;
    return `${url.origin}/${segments.slice(0, statusIdx).join('/')}`;
  } catch {
    return null;
  }
}

/** Configuration for a per-instance {@link DomainPolicy}. */
export interface DomainPolicyConfig {
  /** The app's federation domain (where it mints webfinger / inbox / collection URIs). */
  domain: string;
  /** The host that owns actor URIs; defaults to `domain`. */
  actorDomain?: string;
  /**
   * Oxy's identity apex (e.g. `oxy.so`). Every Oxy/Mention user is ALSO published
   * as `acct:<username>@<apex>` via the DID layer, so an actor on this host is one
   * of OUR OWN users — resolving it as remote would create duplicate actor rows
   * for local users. Blocked when set.
   */
  identityApex?: string;
  /** Additional explicitly-blocked domains (case-insensitive). */
  blockedDomains?: Iterable<string>;
}

/** Per-instance domain policy: which hosts are ours/blocked, and our own post-URI shape. */
export interface DomainPolicy {
  /**
   * True when a domain should be rejected for federation — our own ActivityPub
   * domains, the Oxy identity apex (both publish our own users), or an explicitly
   * configured blocked domain.
   */
  isBlockedDomain(domain: string): boolean;
  /**
   * Extract a local Post id from an ActivityPub object URI that points at one of
   * our own posts (`https://<our-domain>/ap/users/<username>/posts/<postId>`).
   * Returns null when the URI host is not one of ours or the path does not match
   * the canonical scheme (the object is remote, resolved by activityId instead).
   */
  extractLocalPostId(objectUri: string): string | null;
}

/**
 * Build the per-instance {@link DomainPolicy} from an app's domain configuration.
 */
export function createDomainPolicy(config: DomainPolicyConfig): DomainPolicy {
  const localDomains = new Set([
    canonicalDomainHost(config.domain),
    canonicalDomainHost(config.actorDomain ?? config.domain),
  ]);
  const identityApex = config.identityApex ? canonicalDomainHost(config.identityApex) : undefined;
  const blocked = new Set<string>();
  for (const d of config.blockedDomains ?? []) {
    blocked.add(canonicalDomainHost(d));
  }

  return {
    isBlockedDomain(domain: string): boolean {
      const d = canonicalDomainHost(domain);
      return localDomains.has(d) || (identityApex !== undefined && d === identityApex) || blocked.has(d);
    },
    extractLocalPostId(objectUri: string): string | null {
      let parsed: URL;
      try {
        parsed = new URL(objectUri);
      } catch {
        return null;
      }
      if (!localDomains.has(canonicalDomainHost(parsed.host))) return null;
      const match = parsed.pathname.match(/^\/ap\/users\/[^/]+\/posts\/([^/]+)\/?$/);
      return match ? match[1] : null;
    },
  };
}
