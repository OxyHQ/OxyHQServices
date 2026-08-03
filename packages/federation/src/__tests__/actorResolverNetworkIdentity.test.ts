/**
 * The `deriveNetworkIdentity` seam in the actor resolver.
 *
 * The behaviour that matters is a SPLIT: a bridged actor's IDENTITY moves onto the
 * network, while everything that ADDRESSES it over the protocol stays pointed at
 * the bridge. Get that wrong in either direction and something breaks quietly —
 * relabel too much and WebFinger fallback, key resolution and the domain policy
 * all start asking `x.com` about an actor it has never heard of; relabel too
 * little and the account renders under a hostname that tells the reader nothing.
 */

import { createActorResolver, type ActorResolverConfig, type FederatedActorRecordBase } from '../node/actorResolver';
import {
  FEDERATION_NETWORKS,
  createBridgeRelabeller,
  upstreamHandleFromProfileField,
  type DeriveNetworkIdentity,
} from '../networkIdentity';

/**
 * A stand-in registry. This package ships no entries, so the resolver test
 * supplies one — which is the arrangement in production too, only there the
 * entries are an app's reviewed policy.
 */
const relabeller = createBridgeRelabeller([{
  host: 'bird.makeup',
  network: FEDERATION_NETWORKS.x,
  operator: 'test',
  software: 'BirdsiteLive',
  derive: upstreamHandleFromProfileField({ fieldName: 'Official', hosts: ['twitter.com', 'x.com'] }),
  caseRule: 'lowercase',
  relabel: 'enabled',
  upstreamIdStability: 'recyclable',
  boilerplate: [/\s*This account is a replica from Twitter\..*Patreon\.\s*$/s],
  consent: 'unconsented',
  evidence: 'test',
  assumption: '',
  since: '2026-08-02',
}]);
const deriveBridgedNetworkIdentity = relabeller.deriveNetworkIdentity;
import type { NormalizedExternalActor } from '../index';

interface TestActor extends FederatedActorRecordBase {
  uri: string;
}

const BRIDGED_ACTOR = {
  id: 'https://bird.makeup/users/wired',
  type: 'Service',
  preferredUsername: 'wired',
  name: 'WIRED',
  inbox: 'https://bird.makeup/users/wired/inbox',
  summary:
    "The latest in tech.\nThis account is a replica from Twitter. Its author can't see your replies. "
    + 'If you find this service useful, please consider supporting us via our Patreon.',
  attachment: [
    {
      type: 'PropertyValue',
      name: 'Official',
      value: '<a href="https://twitter.com/wired" rel="me nofollow noopener noreferrer">twitter.com/wired</a>',
    },
  ],
};

/**
 * An actor whose ENTIRE bio is the bridge's boilerplate, so stripping it leaves
 * the empty string. Every other fixture here keeps a sentence of its own, and
 * that is the shape that hid a real production bug: an empty result is falsy, so
 * a `bio || undefined` coalesce discarded it and oxy-api — which only writes the
 * field when it is sent a string — kept the boilerplate it had stored months
 * earlier. Fixtures that all strip to something non-empty cannot tell the two
 * readings apart. Seen live on `@elonmusk@x.com`, whose bio is nothing but the
 * notice.
 */
const ALL_BOILERPLATE_ACTOR = {
  ...BRIDGED_ACTOR,
  summary:
    "This account is a replica from Twitter. Its author can't see your replies. "
    + 'If you find this service useful, please consider supporting us via our Patreon.',
};

function makeResolver(deriveNetworkIdentity?: DeriveNetworkIdentity, actorDocument = BRIDGED_ACTOR) {
  const upserts: Array<{ uri: string; update: Record<string, unknown> }> = [];
  const resolved: NormalizedExternalActor[] = [];
  const warnings: string[] = [];

  const config: ActorResolverConfig<TestActor> = {
    federationEnabled: true,
    signedFetch: async (url) => {
      // Collection counts are fetched too; only the actor URL returns a document.
      if (url !== actorDocument.id) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(actorDocument), {
        status: 200,
        headers: { 'content-type': 'application/activity+json' },
      });
    },
    fetchWebFinger: async () => null,
    isBlockedDomain: () => false,
    normalizeFederatedAcct: (acct) => (acct ? acct.replace(/^@/, '').toLowerCase() : undefined),
    domainFromAcct: (acct) => acct.split('@')[1],
    firstStringUrl: () => undefined,
    deriveNetworkIdentity,
    store: {
      findActorByUri: async () => null,
      upsertActor: async (uri, update) => {
        upserts.push({ uri, update: update as unknown as Record<string, unknown> });
        return { uri, _id: 'row-1' };
      },
      findActorByPublicKeyId: async () => null,
      setActorOxyUserId: async () => {},
      tombstoneActor: async () => null,
    },
    identity: {
      resolveExternalUser: async (actor) => {
        resolved.push(actor);
        return 'oxy-user-1';
      },
      reportActorGone: async () => 'archived',
    },
    text: {
      inlineField: (value) => (typeof value === 'string' ? value : ''),
      inlineDisplayName: (raw) => raw,
      sanitizeFieldValue: (html) => html,
      htmlToPlainText: (html) => html,
    },
    logger: { info: () => {}, warn: (message) => { warnings.push(message); } },
  };

  return { resolver: createActorResolver(config), upserts, resolved, warnings };
}

describe('deriveNetworkIdentity — the identity moves, the address does not', () => {
  it('stores a bridged actor under the network it came from', async () => {
    const rig = makeResolver(deriveBridgedNetworkIdentity);
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    expect(rig.resolved).toHaveLength(1);
    expect(rig.resolved[0].federatedUsername).toBe('wired@x.com');
    expect(rig.resolved[0].instanceDomain).toBe('x.com');
  });

  it('keeps acct, uri and the stored domain pointed at the BRIDGE', async () => {
    const rig = makeResolver(deriveBridgedNetworkIdentity);
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    // `handle` is the protocol address the WebFinger fallback and the same-origin
    // guard use; `domain` on the row is what the domain policy and every
    // moderation consumer key off. Neither may follow the identity onto x.com.
    expect(rig.resolved[0].handle).toBe('wired@bird.makeup');
    expect(rig.upserts[0].update.acct).toBe('wired@bird.makeup');
    expect(rig.upserts[0].update.domain).toBe('bird.makeup');
    expect(rig.upserts[0].uri).toBe(BRIDGED_ACTOR.id);
  });

  it('strips the bridge boilerplate from both the stored row and the Oxy identity', async () => {
    const rig = makeResolver(deriveBridgedNetworkIdentity);
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    expect(rig.upserts[0].update.summary).toBe('The latest in tech.');
    expect(rig.resolved[0].bio).toBe('The latest in tech.');
  });

  /**
   * The empty string must SURVIVE as far as the identity bridge. It is the whole
   * instruction: oxy-api writes the bio only when it is sent a string, so
   * dropping it means "leave whatever you stored" — and what it stored is the
   * boilerplate. Asserting `toBe('')` rather than a falsy check on purpose;
   * `undefined` is falsy too, and it is the wrong answer.
   */
  it('still sends a bio when stripping the boilerplate empties it', async () => {
    const rig = makeResolver(deriveBridgedNetworkIdentity, ALL_BOILERPLATE_ACTOR);
    await rig.resolver.fetchRemoteActor(ALL_BOILERPLATE_ACTOR.id);

    expect(rig.upserts[0].update.summary).toBe('');
    expect(rig.resolved[0].bio).toBe('');
  });

  /**
   * Same mechanism, wider blast radius: an ordinary actor who DELETES their bio
   * upstream sends `summary: ''`, which the same coalesce discarded — so a
   * deletion never propagated and Oxy served the old text indefinitely. No
   * bridge involved, which is why this case is here rather than only above.
   */
  it('propagates a bio that was cleared upstream, with no bridge involved', async () => {
    const rig = makeResolver(undefined, { ...BRIDGED_ACTOR, summary: '' });
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    expect(rig.resolved[0].bio).toBe('');
  });

  it('changes nothing at all when no hook is configured', async () => {
    const rig = makeResolver(undefined);
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    expect(rig.resolved[0].federatedUsername).toBe('wired@bird.makeup');
    expect(rig.resolved[0].instanceDomain).toBe('bird.makeup');
    expect(rig.resolved[0].bio).toBe(BRIDGED_ACTOR.summary);
  });

  it('changes nothing when the hook declines the actor', async () => {
    const rig = makeResolver(() => undefined);
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    expect(rig.resolved[0].federatedUsername).toBe('wired@bird.makeup');
    expect(rig.resolved[0].instanceDomain).toBe('bird.makeup');
  });
});

describe('deriveNetworkIdentity — results the engine refuses', () => {
  /**
   * oxy-api binds a federated username to its domain and rejects a mismatch, so
   * an unbindable result must degrade to the actor's real acct rather than be
   * sent onward. It is a bug in the app's rule, so it must also be logged, not
   * swallowed.
   */
  it.each([
    ['username under a different domain', { federatedUsername: 'wired@example.com', instanceDomain: 'x.com', bio: '' }],
    ['username with no domain at all', { federatedUsername: 'wired', instanceDomain: 'x.com', bio: '' }],
    ['empty local part', { federatedUsername: '@x.com', instanceDomain: 'x.com', bio: '' }],
    ['empty domain', { federatedUsername: 'wired@', instanceDomain: '', bio: '' }],
    ['two at-signs', { federatedUsername: 'a@b@x.com', instanceDomain: 'x.com', bio: '' }],
    ['a separator that is not an at-sign', { federatedUsername: 'wired.x.com', instanceDomain: 'x.com', bio: '' }],
  ])('refuses %s and falls back to the protocol acct', async (_label, identity) => {
    const rig = makeResolver(() => identity);
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    expect(rig.resolved[0].federatedUsername).toBe('wired@bird.makeup');
    expect(rig.resolved[0].instanceDomain).toBe('bird.makeup');
    expect(rig.warnings.some((w) => w.includes('not bindable'))).toBe(true);
  });

  it('accepts a bindable result that differs only in case', async () => {
    const rig = makeResolver(() => ({ federatedUsername: 'WIRED@X.com', instanceDomain: 'X.com', bio: 'x' }));
    await rig.resolver.fetchRemoteActor(BRIDGED_ACTOR.id);

    expect(rig.resolved[0].federatedUsername).toBe('wired@x.com');
    expect(rig.resolved[0].instanceDomain).toBe('x.com');
    expect(rig.warnings.some((w) => w.includes('not bindable'))).toBe(false);
  });
});
