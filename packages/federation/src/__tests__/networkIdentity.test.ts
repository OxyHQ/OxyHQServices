/**
 * The network-identity MECHANISM. No bridge entries live in this package, so
 * these drive the machinery with entries defined here in the test — which is
 * also the point: an app supplies its own, and the mechanism must behave the
 * same whatever they are.
 *
 * The entries an app actually ships, and the fixtures pinning their derivation
 * rules against real actors, are tested beside those entries.
 */

import {
  FEDERATION_NETWORKS,
  blueskyUsernameFromHandle,
  createBridgeRelabeller,
  parseUpstreamProfileUrl,
  stripBridgeBoilerplate,
  upstreamHandleFromPreferredUsername,
  upstreamHandleFromProfileField,
  upstreamProfileUrl,
  type FederationBridgeEntry,
  type NetworkIdentityCandidate,
} from '../networkIdentity';

function entry(overrides: Partial<FederationBridgeEntry> = {}): FederationBridgeEntry {
  return {
    host: 'mirror.example',
    network: FEDERATION_NETWORKS.x,
    operator: 'Test operator',
    software: 'TestBridge',
    derive: upstreamHandleFromProfileField({ fieldName: 'Official', hosts: ['twitter.com', 'x.com'] }),
    caseRule: 'lowercase',
    relabel: 'enabled',
    upstreamIdStability: 'recyclable',
    boilerplate: [/\s*Mirrored by mirror\.example\.\s*$/],
    consent: 'unconsented',
    evidence: 'test',
    assumption: '',
    since: '2026-08-02',
    ...overrides,
  };
}

function candidate(overrides: Partial<NetworkIdentityCandidate> = {}): NetworkIdentityCandidate {
  return {
    host: 'mirror.example',
    acct: 'wired@mirror.example',
    preferredUsername: 'WIRED',
    actorUri: 'https://mirror.example/users/WIRED',
    actorType: 'Service',
    alsoKnownAs: [],
    fields: [{ name: 'Official', value: '<a href="https://twitter.com/WIRED" rel="me">x</a>' }],
    bio: 'The latest in tech.\nMirrored by mirror.example.',
    ...overrides,
  };
}

describe('createBridgeRelabeller', () => {
  it('re-labels an actor onto the network its bridge mirrors', () => {
    const identity = createBridgeRelabeller([entry()]).deriveNetworkIdentity(candidate());
    expect(identity?.federatedUsername).toBe('wired@x.com');
    expect(identity?.instanceDomain).toBe('x.com');
    expect(identity?.bio).toBe('The latest in tech.');
  });

  it('declines an actor from a host no entry names', () => {
    const relabeller = createBridgeRelabeller([entry()]);
    expect(relabeller.deriveNetworkIdentity(candidate({ host: 'mastodon.social' }))).toBeUndefined();
  });

  it('ships no entries of its own — an empty registry re-labels nothing', () => {
    expect(createBridgeRelabeller([]).deriveNetworkIdentity(candidate())).toBeUndefined();
  });

  it('preserves case where the entry says the handle is already canonical', () => {
    const identity = createBridgeRelabeller([entry({ caseRule: 'preserve' })])
      .deriveNetworkIdentity(candidate());
    expect(identity?.federatedUsername).toBe('WIRED@x.com');
  });
});

describe('createBridgeRelabeller — the pending_dedup gate', () => {
  /**
   * Re-labelling MANUFACTURES duplicates: two bridges of one network that render
   * as visibly different accounts today both render the same handle afterwards.
   * A `pending_dedup` entry is committed and reviewed but must stay inert.
   */
  it('does not re-label an entry that is pending de-duplication', () => {
    const relabeller = createBridgeRelabeller([entry({ relabel: 'pending_dedup' })]);
    expect(relabeller.deriveNetworkIdentity(candidate())).toBeUndefined();
  });

  it('still finds and vouches for a pending entry, so the trust question is separable', () => {
    const relabeller = createBridgeRelabeller([entry({ relabel: 'pending_dedup' })]);
    expect(relabeller.findBridge('mirror.example')?.relabel).toBe('pending_dedup');
    expect(relabeller.vouchesForNetwork('mirror.example', 'x.com')).toBe(true);
  });
});

describe('createBridgeRelabeller — derivations it refuses', () => {
  /**
   * An empty handle is the signature of a BROKEN rule, not an unusual account,
   * and it is the most destructive outcome available: every actor on the domain
   * would collapse onto one identity. We hold federated actors with no
   * `preferredUsername` at all, so this is reachable rather than theoretical.
   */
  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('refuses a rule that yields %s, rather than collapsing a domain onto one identity', (_label, derived) => {
    // Asserted against the relabeller's OWN guard, with a rule that returns the
    // bad value directly. Driving it through `upstreamHandleFromPreferredUsername`
    // would prove nothing: that helper filters empties itself, so the outer guard
    // is never reached and the assertion passes with the guard deleted.
    const relabeller = createBridgeRelabeller([entry({ derive: () => derived })]);
    expect(relabeller.deriveNetworkIdentity(candidate())).toBeUndefined();
  });

  it('refuses an empty preferredUsername, which we hold real actors with', () => {
    const relabeller = createBridgeRelabeller([
      entry({ derive: upstreamHandleFromPreferredUsername([/./]) }),
    ]);
    expect(relabeller.deriveNetworkIdentity(candidate({ preferredUsername: '' }))).toBeUndefined();
    expect(relabeller.deriveNetworkIdentity(candidate({ preferredUsername: '   ' }))).toBeUndefined();
  });

  it('refuses a handle carrying an at-sign or a slash', () => {
    const relabeller = createBridgeRelabeller([
      entry({ derive: upstreamHandleFromPreferredUsername([/./]) }),
    ]);
    expect(relabeller.deriveNetworkIdentity(candidate({ preferredUsername: 'a@b' }))).toBeUndefined();
    expect(relabeller.deriveNetworkIdentity(candidate({ preferredUsername: 'a/b' }))).toBeUndefined();
  });

  it('derives nothing when the backlink points off the declared network', () => {
    const relabeller = createBridgeRelabeller([entry()]);
    expect(relabeller.deriveNetworkIdentity(candidate({
      fields: [{ name: 'Official', value: '<a href="https://example.com/wired">x</a>' }],
    }))).toBeUndefined();
  });

  it('derives nothing from a link that is not a bare profile path', () => {
    const relabeller = createBridgeRelabeller([entry()]);
    expect(relabeller.deriveNetworkIdentity(candidate({
      fields: [{ name: 'Official', value: '<a href="https://twitter.com/i/status/1">x</a>' }],
    }))).toBeUndefined();
  });

  it('matches profile hosts canonically, so a www. prefix on either side still round-trips', () => {
    const relabeller = createBridgeRelabeller([
      entry({ derive: upstreamHandleFromProfileField({ fieldName: 'Official', hosts: ['www.twitter.com'] }) }),
    ]);
    expect(relabeller.deriveNetworkIdentity(candidate({
      fields: [{ name: 'Official', value: '<a href="https://twitter.com/WIRED" rel="me">x</a>' }],
    }))?.federatedUsername).toBe('wired@x.com');
    expect(relabeller.deriveNetworkIdentity(candidate({
      fields: [{ name: 'Official', value: '<a href="https://www.twitter.com/WIRED" rel="me">x</a>' }],
    }))?.federatedUsername).toBe('wired@x.com');
  });

  it('requires the marker before trusting a naming convention', () => {
    // The bridge operator's own account lives on the same host and is not a
    // mirror of anything; relabelling it would invent an upstream person.
    const relabeller = createBridgeRelabeller([
      entry({ derive: upstreamHandleFromPreferredUsername([/is a mirror bot\.$/]) }),
    ]);
    expect(relabeller.deriveNetworkIdentity(candidate({ bio: 'I run this server.' }))).toBeUndefined();
    expect(relabeller.deriveNetworkIdentity(candidate({ bio: 'is a mirror bot.' }))?.federatedUsername)
      .toBe('wired@x.com');
  });
});

describe('createBridgeRelabeller — the trust predicate a resolver asks', () => {
  it('lets a bridge vouch only for the network it mirrors', () => {
    const relabeller = createBridgeRelabeller([entry()]);
    expect(relabeller.vouchesForNetwork('mirror.example', 'x.com')).toBe(true);
    expect(relabeller.vouchesForNetwork('mirror.example', 'instagram.com')).toBe(false);
    expect(relabeller.vouchesForNetwork('other.example', 'x.com')).toBe(false);
    expect(relabeller.vouchesForNetwork('', 'x.com')).toBe(false);
  });

  it('compares hosts canonically, so case and a www. prefix cannot slip past', () => {
    const relabeller = createBridgeRelabeller([entry()]);
    expect(relabeller.vouchesForNetwork('MIRROR.example', 'X.com')).toBe(true);
    expect(relabeller.findBridge('www.mirror.example')?.host).toBe('mirror.example');
  });
});

describe('boilerplate stripping', () => {
  it('leaves a bio the pattern does not match exactly as written', () => {
    const bio = 'A bio that mentions mirror.example but carries no notice.';
    expect(stripBridgeBoilerplate(bio, entry())).toBe(bio);
  });

  it('strips every declared variant, so a multilingual notice is not half-removed', () => {
    const multilingual = entry({ boilerplate: [/\s*\(bot\)\s*$/, /\s*\(robot\)\s*$/] });
    expect(stripBridgeBoilerplate('Hola (robot)', multilingual)).toBe('Hola');
    expect(stripBridgeBoilerplate('Hello (bot)', multilingual)).toBe('Hello');
  });
});

describe('upstream profile URLs — one declaration, both directions', () => {
  /**
   * Rendering a link and recognising a pasted one are the same fact stated twice.
   * Held as two tables they drift, and the drift lands on the parsing side, where
   * a search that silently finds nothing looks exactly like "we do not have that
   * account" — so it is asserted as a ROUND TRIP rather than in one direction.
   */
  it.each([
    [FEDERATION_NETWORKS.x, 'nasa'],
    [FEDERATION_NETWORKS.instagram, 'robert.habeck'],
    [FEDERATION_NETWORKS.bluesky, 'georgemonbiot.bsky.social'],
  ])('round-trips a $name handle', (network, handle) => {
    const parsed = parseUpstreamProfileUrl(upstreamProfileUrl(network, handle));
    expect(parsed?.network.id).toBe(network.id);
    expect(parsed?.handle).toBe(handle);
  });

  it('recognises a network by its aliases, not only its canonical host', () => {
    expect(parseUpstreamProfileUrl('https://twitter.com/nasa')?.network.id).toBe('x');
    expect(parseUpstreamProfileUrl('https://x.com/nasa')?.network.id).toBe('x');
    expect(parseUpstreamProfileUrl('https://www.instagram.com/nasa')?.network.id).toBe('instagram');
  });

  it('drops the tracking parameters a pasted URL usually carries', () => {
    expect(parseUpstreamProfileUrl('https://x.com/nasa?s=20&t=abc')?.handle).toBe('nasa');
    expect(parseUpstreamProfileUrl('https://x.com/nasa#bio')?.handle).toBe('nasa');
    expect(parseUpstreamProfileUrl('  https://x.com/nasa  ')?.handle).toBe('nasa');
  });

  it('answers undefined for anything that is not an upstream profile URL', () => {
    expect(parseUpstreamProfileUrl('https://x.com/i/status/123')).toBeUndefined();
    expect(parseUpstreamProfileUrl('https://x.com/')).toBeUndefined();
    expect(parseUpstreamProfileUrl('https://mastodon.social/@alice')).toBeUndefined();
    expect(parseUpstreamProfileUrl('not a url')).toBeUndefined();
    expect(parseUpstreamProfileUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('renders on the canonical host even when parsed from an alias', () => {
    const parsed = parseUpstreamProfileUrl('https://twitter.com/nasa');
    expect(parsed && upstreamProfileUrl(parsed.network, parsed.handle)).toBe('https://x.com/nasa');
  });
});

describe('bsky.social is one network, whichever protocol an account arrives by', () => {
  it('strips a default handle\'s redundant suffix and keeps a custom domain whole', () => {
    expect(blueskyUsernameFromHandle('skylee1.bsky.social')).toBe('skylee1');
    expect(blueskyUsernameFromHandle('gothamist.com')).toBe('gothamist.com');
    expect(blueskyUsernameFromHandle('mayor.nyc.gov')).toBe('mayor.nyc.gov');
    expect(blueskyUsernameFromHandle('jay.bsky.team')).toBe('jay.bsky.team');
    expect(blueskyUsernameFromHandle('bsky.social')).toBe('bsky.social');
  });
});
