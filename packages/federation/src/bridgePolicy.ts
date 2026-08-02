/**
 * WHICH HOSTS REPUBLISH ANOTHER NETWORK'S ACCOUNTS, AND HOW TO READ THE REAL
 * IDENTITY BACK OUT OF THEM.
 *
 * A BRIDGE is a fediverse host that mirrors accounts from somewhere else. The
 * account it publishes as `@WIRED@mastox.eu` is not a person on mastox.eu — it is
 * WIRED, on X, copied. Naming that account after the bridge tells a reader
 * nothing they can act on: the hostname is an implementation detail of how the
 * post reached us, and the thing they actually want to know is which account on
 * which network wrote it. So an actor from a listed bridge is stored and rendered
 * under the NETWORK it came from — `@wired@x.com` — exactly as an atproto actor
 * with a custom-domain handle is stored under `bsky.social` rather than under the
 * domain the handle happens to spell.
 *
 * WHY THIS LIVES IN THE SHARED PACKAGE AND NOT IN AN APP
 *
 *   Two consumers have to agree on it or the relabel cannot work at all.
 *   An app's connector DERIVES the identity at ingest, and oxy-api's
 *   `PUT /users/resolve` DECIDES WHETHER TO BELIEVE IT — that endpoint binds an
 *   actor URI's hostname to the domain the caller asserts, precisely so a service
 *   cannot claim to vouch for a user on a host it does not own. A bridged
 *   identity is the one case where those legitimately differ, and the ONLY thing
 *   that makes it legitimate rather than a forged claim is this list. If each
 *   side kept its own copy, the copies would drift, and the failure mode of that
 *   drift is oxy-api accepting an attribution nobody reviewed. One list, imported
 *   by both.
 *
 * A WRONG ENTRY HERE MISATTRIBUTES SOMEBODY'S WRITING
 *
 *   That is a heavier failure than the blocklist's. A wrong block loses content
 *   and somebody complains; a wrong bridge entry silently publishes one person's
 *   posts under another person's name, on a network they may not even use. So
 *   every entry records what was actually VERIFIED against a live actor
 *   ({@link FederationBridgeEntry.evidence}) separately from what is merely
 *   ASSUMED ({@link FederationBridgeEntry.assumption}), and no entry may be added
 *   without a stored fixture and a test that fails if its rule stops
 *   round-tripping. Derivation is per-ACTOR and fails closed: an actor that does
 *   not satisfy its bridge's rule keeps the bridge hostname, because a bridge's
 *   own admin and service accounts are real accounts on that host and relabelling
 *   them would invent an upstream person who does not exist.
 *
 * THIS IS NOT THE BLOCKLIST, AND MUST NEVER BE MERGED WITH IT
 *
 *   Blocking and bridge-trust are opposite decisions about a host, and the
 *   blocklist wins: a blocked host is refused before any actor from it is ever
 *   built, so no relabel can resurrect it. Keeping them in separate structures
 *   means neither can be edited into the other by accident.
 */

import { canonicalFederationHost } from './apUri';

/**
 * A network accounts can be bridged FROM.
 *
 * `domain` is the identity domain — the part after the `@` in a rendered handle,
 * and the `domain` bound to a federated Oxy username. It is the network's
 * canonical public host (`x.com`, not `twitter.com`), because that is what a
 * reader recognises and what a profile link resolves to.
 */
export interface FederationNetwork {
  /** Stable key for this network (used to group bridges that mirror the same one). */
  readonly id: string;
  /** Human name, for logs and review output. */
  readonly name: string;
  /** The identity domain handles are rendered and stored under. */
  readonly domain: string;
}

/**
 * The networks Oxy re-labels accounts onto.
 *
 * Bluesky is here for a reason beyond bridging: it is the network the atproto
 * connector ingests DIRECTLY, and its domain used to be a constant private to
 * that connector. Both readers now take it from here, so a Bluesky account
 * reaching us over atproto and the same account reaching us over ActivityPub
 * through Bridgy Fed cannot end up under two different domains — which is what
 * would happen if the two paths each named the network themselves.
 */
export const FEDERATION_NETWORKS = {
  x: { id: 'x', name: 'X', domain: 'x.com' },
  instagram: { id: 'instagram', name: 'Instagram', domain: 'instagram.com' },
  bluesky: { id: 'bluesky', name: 'Bluesky', domain: 'bsky.social' },
} as const satisfies Record<string, FederationNetwork>;

/** The Bluesky network's canonical identity domain — see {@link FEDERATION_NETWORKS}. */
export const BSKY_NETWORK_DOMAIN = FEDERATION_NETWORKS.bluesky.domain;

/** A profile field as the actor cache stores it (only what a derivation rule reads). */
export interface BridgedActorField {
  readonly name: string;
  readonly value: string;
}

/**
 * Everything a derivation rule may look at. Every field is a value the caller has
 * already derived and verified, so a rule never re-parses the actor document.
 */
export interface NetworkIdentityCandidate {
  /** The lowercase host the actor is authoritative for (post-redirect). */
  readonly host: string;
  /** The canonical `user@host` acct — the actor's PROTOCOL address. */
  readonly acct: string;
  /** `preferredUsername` verbatim, case preserved. */
  readonly preferredUsername: string;
  /** The actor's own `id`. */
  readonly actorUri: string;
  /** The AP `type` (`Person` / `Service` / `Application` / …). */
  readonly actorType: string;
  /** `alsoKnownAs`, verbatim (empty when the actor publishes none). */
  readonly alsoKnownAs: readonly string[];
  /** The actor's profile fields (PropertyValue), already sanitized. */
  readonly fields: readonly BridgedActorField[];
  /** The actor's bio as plain text. */
  readonly bio: string;
}

/**
 * An actor re-labelled onto the network its identity really belongs to.
 *
 * `federatedUsername` MUST end with `@${instanceDomain}` — oxy-api binds a
 * federated username to its domain — and the caller REFUSES a result that does
 * not, rather than minting an identity oxy-api would reject.
 */
export interface NetworkIdentity {
  /** The canonical `<user>@<network-domain>` identity (e.g. `wired@x.com`). */
  readonly federatedUsername: string;
  /** The network domain the identity belongs to (e.g. `x.com`). */
  readonly instanceDomain: string;
  /** The bio with the bridge's own appended boilerplate removed. */
  readonly bio: string;
}

/**
 * App-supplied re-labelling of an ingested actor onto its real network. Returns
 * `undefined` for anything not recognised — which is the overwhelmingly common
 * case, and the correct answer whenever the derivation is not certain.
 */
export type DeriveNetworkIdentity = (
  candidate: NetworkIdentityCandidate,
) => NetworkIdentity | undefined;

/**
 * Whether the people mirrored by a bridge asked to be.
 *
 * Recorded because it is the question a mirrored person asks first, and because
 * it changes what a reasonable response to a complaint is. It deliberately does
 * NOT gate the relabel: an unconsented mirror is still that person's writing, and
 * attributing it to them is more honest than attributing it to the bridge.
 *
 *  - `opt-in`       the upstream account took an action to enable the bridge.
 *  - `unconsented`  the bridge mirrors without asking; removal is on request.
 */
export type BridgeConsentModel = 'opt-in' | 'unconsented';

/** How the upstream handle is recovered from a bridged actor. */
export type BridgeDerivation = (candidate: NetworkIdentityCandidate) => string | undefined;

/** One reviewed bridge. */
export interface FederationBridgeEntry {
  /**
   * The bridge's host, CANONICAL — lowercase, bare host, no scheme, no `www.`.
   * Matching is exact canonical-host membership, so a subdomain is a different
   * host and needs its own reviewed entry.
   */
  readonly host: string;
  /** The network accounts here are mirrored FROM. */
  readonly network: FederationNetwork;
  /** Who runs the bridge, as they identify themselves. */
  readonly operator: string;
  /** The bridge software, as its own nodeinfo reports it. */
  readonly software: string;
  /**
   * Recover the upstream handle from ONE actor, or `undefined` when this actor
   * does not satisfy the rule — which is how the bridge's own admin/service
   * accounts, and anything whose shape changed, are left alone.
   */
  readonly derive: BridgeDerivation;
  /**
   * What to do with the recovered handle's case before storing it.
   *
   *  - `lowercase` the upstream network treats handles case-insensitively, so
   *    lowercasing loses no addressability and keeps the handle rendering like
   *    every other federated handle (AP acct normalisation lowercases them all).
   *  - `preserve`  the handle is a DNS name and is already canonical; touching it
   *    would change what it addresses.
   */
  readonly caseRule: 'lowercase' | 'preserve';
  /** Build the upstream profile URL for a derived handle (for links and review). */
  readonly upstreamProfileUrl: (handle: string) => string;
  /**
   * The bridge's own appended boilerplate, to strip from the bio.
   *
   * Per-bridge and anchored, never a general "looks like boilerplate" heuristic:
   * a pattern that does not match leaves the bio EXACTLY as written, which is the
   * only safe behaviour when the alternative is deleting a line the author wrote.
   * Several bridges emit the same notice in more than one language, so this is a
   * list and every variant that has been observed is listed.
   */
  readonly boilerplate: readonly RegExp[];
  /** Whether the mirrored accounts asked to be mirrored. */
  readonly consent: BridgeConsentModel;
  /** What was VERIFIED against a live actor, and where the fixture came from. */
  readonly evidence: string;
  /**
   * What is ASSUMED rather than verified. Empty string means the derivation reads
   * an assertion the actor itself publishes, so nothing is being guessed.
   */
  readonly assumption: string;
  /** `YYYY-MM-DD` — the day the entry took effect. */
  readonly since: string;
}

/**
 * The handle a profile URL addresses: the single path segment that follows the
 * network's fixed profile prefix (`x.com/<handle>` has none, `bsky.app` uses
 * `profile/`), on one of the network's own hosts.
 *
 * Exact — one segment after the prefix and nothing more — so a link to some other
 * page on the same host (`x.com/i/status/123`) yields nothing rather than a
 * plausible-looking wrong handle.
 */
function profileUrlHandle(
  href: string,
  allowedHosts: readonly string[],
  pathPrefix: readonly string[],
): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (!allowedHosts.includes(canonicalFederationHost(url.hostname))) return undefined;

  const segments = url.pathname.split('/').filter((s) => s.length > 0);
  if (segments.length !== pathPrefix.length + 1) return undefined;
  for (let i = 0; i < pathPrefix.length; i += 1) {
    if (segments[i].toLowerCase() !== pathPrefix[i]) return undefined;
  }
  return decodeURIComponent(segments[pathPrefix.length]);
}

/** Every `href="…"` in a sanitized field value, in document order. */
function fieldHrefs(value: string): string[] {
  const hrefs: string[] = [];
  const pattern = /href="([^"]*)"/gi;
  let match = pattern.exec(value);
  while (match !== null) {
    hrefs.push(match[1]);
    match = pattern.exec(value);
  }
  return hrefs;
}

/**
 * Read the upstream handle out of a named profile field that links to the
 * upstream profile — the STRONGEST rule available, because the bridge is
 * publishing a machine-readable assertion of which account this mirrors rather
 * than leaving us to infer it from the username.
 */
export function upstreamHandleFromProfileField(options: {
  readonly fieldName: string;
  readonly hosts: readonly string[];
  /** Fixed path segments before the handle (`bsky.app/profile/<handle>` ⇒ `['profile']`). */
  readonly pathPrefix?: readonly string[];
}): BridgeDerivation {
  const wanted = options.fieldName.toLowerCase();
  const prefix = options.pathPrefix ?? [];
  return (candidate) => {
    for (const field of candidate.fields) {
      if (field.name.trim().toLowerCase() !== wanted) continue;
      for (const href of fieldHrefs(field.value)) {
        const handle = profileUrlHandle(href, options.hosts, prefix);
        if (handle !== undefined && handle.length > 0) return handle;
      }
    }
    return undefined;
  };
}

/**
 * Use the actor's own `preferredUsername` as the upstream handle, but ONLY for an
 * actor that carries one of the bridge's mirror notices.
 *
 * The notice is what distinguishes a mirrored account from a real account on the
 * bridge host: the operator's own admin account lives there too and is not a
 * mirror of anything. Without the marker requirement this rule would relabel that
 * person onto a network they may not even be on.
 */
export function upstreamHandleFromPreferredUsername(markers: readonly RegExp[]): BridgeDerivation {
  return (candidate) => {
    if (!markers.some((marker) => marker.test(candidate.bio))) return undefined;
    const handle = candidate.preferredUsername.trim();
    return handle.length > 0 ? handle : undefined;
  };
}

/**
 * The username a Bluesky handle is stored under, given that the instance domain
 * is ALWAYS `bsky.social`.
 *
 * A Bluesky handle is a whole DNS name identifying the account, not a `local@host`
 * address, so the account is on the Bluesky network however many labels the handle
 * has. Once the instance domain is already `bsky.social`, the `.bsky.social`
 * suffix on a DEFAULT handle is redundant and is dropped — otherwise the handle
 * renders as the doubled `@skylee1.bsky.social@bsky.social`. A CUSTOM domain
 * handle is not a `.bsky.social` handle, so it is kept whole:
 *
 *   - `skylee1.bsky.social` → `skylee1`
 *   - `gothamist.com`       → `gothamist.com`
 *   - `mayor.nyc.gov`       → `mayor.nyc.gov`   (never the bogus `nyc.gov` instance)
 *   - `jay.bsky.team`       → `jay.bsky.team`   (`.bsky.team` is not `.bsky.social`)
 *
 * Exported, and used by BOTH paths a Bluesky account can reach us by — the atproto
 * connector reading it directly, and the Bridgy Fed entry below reading it over
 * ActivityPub. That is the point: the same account arriving by two protocols has
 * to produce the same username or the two rows are two people.
 *
 * `bsky.social` itself is guarded: stripping would leave an empty username, so the
 * whole handle is kept.
 */
export function blueskyUsernameFromHandle(handle: string): string {
  const suffix = `.${FEDERATION_NETWORKS.bluesky.domain}`;
  return handle !== FEDERATION_NETWORKS.bluesky.domain && handle.endsWith(suffix)
    ? handle.slice(0, -suffix.length)
    : handle;
}

/** bird.makeup / kilogram.makeup emit this notice, differing only in the network name. */
/** Everything after the network name, which is the only part that varies. */
const MAKEUP_REPLICA_NOTICE_TAIL =
  "\\.\\s*Its author can't see your replies\\.\\s*If you find this service useful, "
  + 'please consider supporting us via our Patreon\\.\\s*$';

function makeupReplicaNotice(network: string): RegExp {
  return new RegExp(`\\s*This account is a replica from ${network}${MAKEUP_REPLICA_NOTICE_TAIL}`);
}

/**
 * THE COMMITTED BRIDGE POLICY.
 *
 * Arrived at by sweeping the self-description (nodeinfo + the Mastodon-style
 * instance API) of EVERY federated domain Mention holds an actor from, not a
 * sample of the largest ones — every bridge below sits far outside the top 60 by
 * actor count, so a survey of the head would have reported that none exist.
 */
export const FEDERATION_BRIDGE_POLICY: readonly FederationBridgeEntry[] = [
  {
    host: 'bird.makeup',
    network: FEDERATION_NETWORKS.x,
    operator: 'Vincent Cloutier (bird.makeup)',
    software: 'BirdsiteLive',
    derive: upstreamHandleFromProfileField({ fieldName: 'Official', hosts: ['twitter.com', 'x.com'] }),
    caseRule: 'lowercase',
    upstreamProfileUrl: (handle) => `https://x.com/${handle}`,
    boilerplate: [makeupReplicaNotice('Twitter')],
    consent: 'unconsented',
    evidence:
      'Every mirrored actor publishes an `Official` profile field whose rel="me" link is '
      + 'https://twitter.com/<handle> — the bridge states which upstream account it mirrors, so the '
      + 'handle is read from that assertion rather than inferred. Verified against the stored actor '
      + 'rows for typecache, gorskon and giswqs, and against a live fetch of bird.makeup/users/nasa.',
    assumption: '',
    since: '2026-08-02',
  },
  {
    host: 'kilogram.makeup',
    network: FEDERATION_NETWORKS.instagram,
    operator: 'Vincent Cloutier (bird.makeup)',
    software: 'BirdsiteLive',
    derive: upstreamHandleFromProfileField({ fieldName: 'Official', hosts: ['instagram.com'] }),
    caseRule: 'lowercase',
    upstreamProfileUrl: (handle) => `https://www.instagram.com/${handle}`,
    boilerplate: [makeupReplicaNotice('Instagram')],
    consent: 'unconsented',
    evidence:
      'Same software and same `Official` rel="me" assertion as bird.makeup, pointing at '
      + 'https://www.instagram.com/<handle>. Verified against the stored actor rows for '
      + 'robert.habeck, umwelthilfe and plex — note Instagram handles may contain dots, which the '
      + 'single-path-segment rule preserves.',
    assumption: '',
    since: '2026-08-02',
  },
  {
    host: 'mastox.eu',
    network: FEDERATION_NETWORKS.x,
    operator: 'mastox.eu (contact @admin@mastox.eu)',
    software: 'Mastodon',
    derive: upstreamHandleFromPreferredUsername([
      /\(bot from x to mastodon managed by mastox\.eu, contact @admin for any information\)\s*$/i,
      /\(bot de x . mastodon g.r. par mastox\.eu, contactez @admin pour toute demande\)\s*$/i,
    ]),
    caseRule: 'lowercase',
    upstreamProfileUrl: (handle) => `https://x.com/${handle}`,
    boilerplate: [
      /\s*\(bot from x to mastodon managed by mastox\.eu, contact @admin for any information\)\s*$/i,
      /\s*\(bot de x . mastodon g.r. par mastox\.eu, contactez @admin pour toute demande\)\s*$/i,
    ],
    consent: 'unconsented',
    evidence:
      'The instance describes itself as "une instance Mastodon de miroir non officiels de comptes X '
      + 'vers Mastodon", and every mirrored actor appends a per-account notice naming itself a bot '
      + 'from X — which is what identifies a mirror here, since the operator\'s own @admin account '
      + 'lives on the same host and carries no such notice. Verified against the stored rows for '
      + 'mehdirhasan, FranceskAlbs and gbsumudflotilla (English notice) and a live fetch of '
      + 'mastox.eu/users/RERB (French notice).',
    assumption:
      'That the mirrored account\'s preferredUsername equals the upstream X handle. Unlike the two '
      + 'BirdsiteLive bridges, a mastox.eu actor publishes NO link to the X account it mirrors — no '
      + 'alsoKnownAs, no rel="me" to x.com — so this mapping rests on the instance-level declaration '
      + 'plus the naming convention, and is the one derivation here that is not read off an assertion '
      + 'the actor makes about itself.',
    since: '2026-08-02',
  },
  {
    host: 'bsky.brid.gy',
    network: FEDERATION_NETWORKS.bluesky,
    operator: 'Ryan Barrett (Bridgy Fed)',
    software: 'bridgy-fed',
    // The `bsky.app/profile/<handle>` link carries the FULL Bluesky handle, so the
    // same `.bsky.social`-suffix rule the atproto connector applies has to run
    // here too — without it `georgemonbiot.bsky.social` would be stored as the
    // doubled `@georgemonbiot.bsky.social@bsky.social` and would NOT match the row
    // the direct connector already holds for that account.
    derive: (candidate) => {
      const handle = upstreamHandleFromProfileField({
        fieldName: 'Web site',
        hosts: ['bsky.app'],
        pathPrefix: ['profile'],
      })(candidate);
      return handle === undefined ? undefined : blueskyUsernameFromHandle(handle);
    },
    caseRule: 'preserve',
    upstreamProfileUrl: (handle) => `https://bsky.app/profile/${handle}`,
    boilerplate: [
      /\s*🌉\s*\S+\s+from\s+🦋\s+\S+, follow (?:@bsky\.brid\.gy|\S+) to interact\s*$/u,
    ],
    consent: 'opt-in',
    evidence:
      'Bridgy Fed only bridges a Bluesky account once that account opts in, and each bridged actor '
      + 'publishes a `Web site` rel="me" link to https://bsky.app/profile/<handle> plus its atproto '
      + 'DID in alsoKnownAs — the same DID the atproto connector keys its own row on, which is what '
      + 'makes the two paths provably the same account. Verified against the stored rows for '
      + 'thistleandmoss.com, georgemonbiot.bsky.social and assignedmale.bsky.social, and a live fetch '
      + 'of bsky.brid.gy/ap/did:plc:z72i7hdynmk6r22z27h6tvur.',
    assumption: '',
    since: '2026-08-02',
  },
];

/** The committed policy indexed by canonical host. */
const BRIDGES_BY_HOST: ReadonlyMap<string, FederationBridgeEntry> = new Map(
  FEDERATION_BRIDGE_POLICY.map((entry) => [canonicalFederationHost(entry.host), entry]),
);

/**
 * The reviewed bridge for a host, or `undefined` for the overwhelming majority of
 * hosts, which are not bridges.
 *
 * Callers that enforce a domain policy MUST refuse a blocked host BEFORE asking
 * this — blocking and bridge-trust are opposite decisions and the block wins. The
 * lookup deliberately does not take a blocklist argument, so it can never be
 * mistaken for the place that decision is made.
 */
export function findFederationBridge(host: string): FederationBridgeEntry | undefined {
  return BRIDGES_BY_HOST.get(canonicalFederationHost(host));
}

/**
 * Whether `actorHost` is a reviewed bridge that mirrors accounts from
 * `networkDomain` — the question oxy-api's `PUT /users/resolve` asks before it
 * accepts a federated identity whose actor URI host differs from the domain it is
 * being stored under.
 *
 * Both sides must match: a bridge vouches ONLY for the one network it mirrors, so
 * being a known bridge is never on its own a licence to claim any domain.
 */
export function bridgeVouchesForNetwork(actorHost: string, networkDomain: string): boolean {
  const bridge = findFederationBridge(actorHost);
  if (!bridge) return false;
  return canonicalFederationHost(bridge.network.domain) === canonicalFederationHost(networkDomain);
}

/** Strip a bridge's own appended boilerplate, leaving anything it does not match untouched. */
export function stripBridgeBoilerplate(bio: string, entry: FederationBridgeEntry): string {
  let result = bio;
  for (const pattern of entry.boilerplate) {
    result = result.replace(pattern, '');
  }
  return result.trimEnd();
}

/**
 * Re-label a bridged actor onto its real network, or return `undefined` when the
 * actor is not from a reviewed bridge or does not satisfy that bridge's rule.
 *
 * This is the whole policy applied end to end: look the host up, run the entry's
 * derivation, apply its case rule, and strip its boilerplate. It never inspects a
 * blocklist — see {@link findFederationBridge}.
 */
export const deriveBridgedNetworkIdentity: DeriveNetworkIdentity = (candidate) => {
  const entry = findFederationBridge(candidate.host);
  if (!entry) return undefined;

  const derived = entry.derive(candidate);
  if (derived === undefined) return undefined;

  const handle = entry.caseRule === 'lowercase' ? derived.toLowerCase() : derived;
  // A handle carrying an `@` or a `/` would produce an unparseable or
  // host-crossing identity; refuse rather than store something that reads as a
  // different account than it addresses.
  if (handle.length === 0 || handle.includes('@') || handle.includes('/')) return undefined;

  const instanceDomain = canonicalFederationHost(entry.network.domain);
  if (instanceDomain.length === 0) return undefined;

  return {
    federatedUsername: `${handle}@${instanceDomain}`,
    instanceDomain,
    bio: stripBridgeBoilerplate(candidate.bio, entry),
  };
};
