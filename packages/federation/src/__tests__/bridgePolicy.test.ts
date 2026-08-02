/**
 * The bridge policy, checked against REAL bridged actors.
 *
 * The load-bearing assertion is the round trip: every fixture must derive to the
 * exact handle its bridge asserts upstream. That is the property a wrong entry
 * breaks, and breaking it is how a whole domain gets misattributed — so it is
 * stated per actor with the expected value written out, never computed from the
 * same rule under test.
 */

import {
  FEDERATION_BRIDGE_POLICY,
  FEDERATION_NETWORKS,
  blueskyUsernameFromHandle,
  bridgeVouchesForNetwork,
  deriveBridgedNetworkIdentity,
  findFederationBridge,
  stripBridgeBoilerplate,
  type FederationBridgeEntry,
  type NetworkIdentityCandidate,
} from '../bridgePolicy';
import { BRIDGED_ACTOR_FIXTURES } from './fixtures/bridgedActors';

/**
 * The fixture whose actor URI ends with `suffix`. Throws rather than returning
 * `undefined` so a fixture that disappears fails as a named error instead of a
 * confusing assertion about `undefined` several lines later.
 */
function fixture(suffix: string): NetworkIdentityCandidate {
  const found = BRIDGED_ACTOR_FIXTURES.find((candidate) => candidate.actorUri.endsWith(suffix));
  if (!found) throw new Error(`no captured fixture for actor URI ending "${suffix}"`);
  return found;
}

/** The reviewed entry for `host`, or a named failure if the policy no longer lists it. */
function entryFor(host: string): FederationBridgeEntry {
  const found = findFederationBridge(host);
  if (!found) throw new Error(`no bridge entry for "${host}"`);
  return found;
}

/** The identity each captured actor MUST re-label to, written out by hand. */
const EXPECTED_IDENTITY: Readonly<Record<string, string>> = {
  'https://bird.makeup/users/typecache': 'typecache@x.com',
  'https://bird.makeup/users/gorskon': 'gorskon@x.com',
  'https://bird.makeup/users/giswqs': 'giswqs@x.com',
  'https://kilogram.makeup/users/robert.habeck': 'robert.habeck@instagram.com',
  'https://kilogram.makeup/users/umwelthilfe': 'umwelthilfe@instagram.com',
  'https://kilogram.makeup/users/plex': 'plex@instagram.com',
  'https://mastox.eu/ap/users/116193264000459783': 'mehdirhasan@x.com',
  'https://mastox.eu/users/FranceskAlbs': 'franceskalbs@x.com',
  'https://mastox.eu/users/gbsumudflotilla': 'gbsumudflotilla@x.com',
  'https://bsky.brid.gy/ap/did:plc:m4jmanw3astpwhqp54g6yslu': 'thistleandmoss.com@bsky.social',
  'https://bsky.brid.gy/ap/did:plc:codfx2epdduamfycuyi5fjpb': 'georgemonbiot@bsky.social',
  'https://bsky.brid.gy/ap/did:plc:vcmpg73bt2wudku3nqgx33yx': 'assignedmale@bsky.social',
};

describe('bridge policy — derivation round-trips against real actors', () => {
  it('covers every fixture (guards against a fixture file that silently emptied)', () => {
    expect(BRIDGED_ACTOR_FIXTURES.length).toBe(12);
    expect(Object.keys(EXPECTED_IDENTITY)).toHaveLength(BRIDGED_ACTOR_FIXTURES.length);
    expect(new Set(BRIDGED_ACTOR_FIXTURES.map((f) => f.host)).size).toBe(4);
  });

  it.each(BRIDGED_ACTOR_FIXTURES.map((f) => [f.actorUri, f] as const))(
    're-labels %s',
    (actorUri, candidate) => {
      const identity = deriveBridgedNetworkIdentity(candidate);
      if (!identity) throw new Error(`${actorUri} derived no identity`);
      expect(identity.federatedUsername).toBe(EXPECTED_IDENTITY[actorUri]);
      // oxy-api binds a federated username to its domain; a result that does not
      // satisfy that is rejected downstream, so assert it here per actor.
      expect(identity.federatedUsername.endsWith(`@${identity.instanceDomain}`)).toBe(true);
    },
  );

  it('strips each bridge\'s own boilerplate and leaves the author\'s own words', () => {
    const identity = deriveBridgedNetworkIdentity(fixture('/users/giswqs'));
    expect(identity?.bio).toBe(
      'Associate Professor @utkgeography | @amazon Scholar | Talk about #opensource #geospatial #dataviz #GeoAI',
    );

    expect(deriveBridgedNetworkIdentity(fixture('/users/gbsumudflotilla'))?.bio).toBe(
      'The World’s Biggest Maritime Mission to Break the Illegal Israeli Siege on Gaza. '
      + 'This is our only official account. Registrations open ↓',
    );

    expect(deriveBridgedNetworkIdentity(fixture('did:plc:codfx2epdduamfycuyi5fjpb'))?.bio)
      .toBe('Ungainly on land');
  });

  it('leaves a bio the pattern does not match completely untouched', () => {
    const bio = 'A bio that mentions mastox.eu but carries no notice.';
    expect(stripBridgeBoilerplate(bio, entryFor('mastox.eu'))).toBe(bio);
  });
});

describe('bridge policy — what it refuses', () => {
  it('does not re-label the bridge operator\'s own account', () => {
    // Captured live from https://mastox.eu/users/admin: a `Person`, not a mirror,
    // whose bio describes the SERVICE without carrying the per-account notice.
    // Relabelling this human onto x.com would invent an X account called `admin`.
    const admin = {
      host: 'mastox.eu',
      acct: 'admin@mastox.eu',
      preferredUsername: 'admin',
      actorUri: 'https://mastox.eu/users/admin',
      actorType: 'Person',
      alsoKnownAs: [],
      fields: [],
      bio:
        "Administrateur de l'instance Mastox, miroir de comptes twitter/X vers Mastodon.\n\n"
        + 'Admin of the Mastox instance, a twitter/X to Mastodon mirror system.',
    } as const;
    expect(deriveBridgedNetworkIdentity(admin)).toBeUndefined();
  });

  it('does not re-label the instance actor', () => {
    // https://mastox.eu/actor — an `Application` named `mastodon.internal`.
    expect(deriveBridgedNetworkIdentity({
      host: 'mastox.eu',
      acct: 'mastodon.internal@mastox.eu',
      preferredUsername: 'mastodon.internal',
      actorUri: 'https://mastox.eu/actor',
      actorType: 'Application',
      alsoKnownAs: [],
      fields: [],
      bio: '',
    })).toBeUndefined();
  });

  it('does not re-label an ordinary actor from a host that is not a bridge', () => {
    expect(deriveBridgedNetworkIdentity({
      host: 'mastodon.social',
      acct: 'alice@mastodon.social',
      preferredUsername: 'alice',
      actorUri: 'https://mastodon.social/users/alice',
      actorType: 'Person',
      alsoKnownAs: [],
      fields: [{ name: 'Official', value: '<a href="https://twitter.com/alice">x</a>' }],
      bio: '',
    })).toBeUndefined();
  });

  it('ignores a profile field pointing somewhere other than the declared network', () => {
    // A bridged actor whose `Official` link is not an upstream profile derives
    // nothing rather than deriving from the wrong host.
    expect(deriveBridgedNetworkIdentity({
      host: 'bird.makeup',
      acct: 'someone@bird.makeup',
      preferredUsername: 'someone',
      actorUri: 'https://bird.makeup/users/someone',
      actorType: 'Service',
      alsoKnownAs: [],
      fields: [{ name: 'Official', value: '<a href="https://example.com/someone">x</a>' }],
      bio: '',
    })).toBeUndefined();
  });

  it('refuses a derived handle that is not a single path segment', () => {
    expect(deriveBridgedNetworkIdentity({
      host: 'bird.makeup',
      acct: 'someone@bird.makeup',
      preferredUsername: 'someone',
      actorUri: 'https://bird.makeup/users/someone',
      actorType: 'Service',
      alsoKnownAs: [],
      fields: [{ name: 'Official', value: '<a href="https://twitter.com/a/b">x</a>' }],
      bio: '',
    })).toBeUndefined();
  });
});

describe('bridge policy — the trust predicate oxy-api asks', () => {
  it('lets a bridge vouch only for the one network it mirrors', () => {
    expect(bridgeVouchesForNetwork('bird.makeup', 'x.com')).toBe(true);
    expect(bridgeVouchesForNetwork('bird.makeup', 'instagram.com')).toBe(false);
    expect(bridgeVouchesForNetwork('kilogram.makeup', 'instagram.com')).toBe(true);
    expect(bridgeVouchesForNetwork('bsky.brid.gy', 'bsky.social')).toBe(true);
  });

  it('vouches for nothing from a host that is not a reviewed bridge', () => {
    expect(bridgeVouchesForNetwork('mastodon.social', 'x.com')).toBe(false);
    expect(bridgeVouchesForNetwork('attacker.example', 'x.com')).toBe(false);
    expect(bridgeVouchesForNetwork('', 'x.com')).toBe(false);
  });

  it('compares hosts canonically, so case and a www. prefix cannot slip past', () => {
    expect(bridgeVouchesForNetwork('BIRD.makeup', 'X.com')).toBe(true);
    expect(findFederationBridge('www.mastox.eu')?.host).toBe('mastox.eu');
  });
});

describe('bridge policy — the entries themselves', () => {
  it('is written in the canonical host form it is compared in', () => {
    for (const entry of FEDERATION_BRIDGE_POLICY) {
      expect(entry.host).toBe(entry.host.trim().toLowerCase());
      expect(entry.host.startsWith('www.')).toBe(false);
      expect(entry.host).not.toContain('/');
    }
  });

  it('names one host once', () => {
    const hosts = FEDERATION_BRIDGE_POLICY.map((e) => e.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it('records evidence for every entry, and an assumption wherever one is being made', () => {
    for (const entry of FEDERATION_BRIDGE_POLICY) {
      expect(entry.evidence.length).toBeGreaterThan(80);
      expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // mastox.eu is the one entry whose handle mapping is inferred rather than read
    // off an assertion the actor publishes; that has to be stated, not implied by
    // an empty field that also means "nobody checked".
    expect(findFederationBridge('mastox.eu')?.assumption.length).toBeGreaterThan(80);
    expect(findFederationBridge('bird.makeup')?.assumption).toBe('');
  });

  it('builds an upstream profile URL on the network, not on the bridge', () => {
    expect(findFederationBridge('bird.makeup')?.upstreamProfileUrl('wired')).toBe('https://x.com/wired');
    expect(findFederationBridge('kilogram.makeup')?.upstreamProfileUrl('nasa'))
      .toBe('https://www.instagram.com/nasa');
    expect(findFederationBridge('bsky.brid.gy')?.upstreamProfileUrl('bsky.app'))
      .toBe('https://bsky.app/profile/bsky.app');
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

  it('gives the SAME username whether the account came over atproto or over Bridgy Fed', () => {
    // The direct connector applies `blueskyUsernameFromHandle` to the handle; the
    // ActivityPub path applies the bridge entry. If these ever disagree the same
    // person becomes two accounts, which is the failure the shared network record
    // exists to prevent.
    const viaAtproto = `${blueskyUsernameFromHandle('georgemonbiot.bsky.social')}@${FEDERATION_NETWORKS.bluesky.domain}`;
    const bridged = fixture('did:plc:codfx2epdduamfycuyi5fjpb');
    expect(deriveBridgedNetworkIdentity(bridged)?.federatedUsername).toBe(viaAtproto);
  });
});
