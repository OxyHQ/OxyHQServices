import {
  AP_CONTEXT,
  createLocalActorBuilder,
  createUrlBuilders,
  type ActorMediaResolver,
} from '../index';

/**
 * GOLDEN VECTOR — the exact `Person` actor document the engine emits.
 *
 * The bytes of this document are load-bearing: Mastodon negative-caches a
 * malformed actor for minutes/hours, so ANY drift in the field set, key ORDER,
 * `@context` terms, URL shapes, or the `publicKey` (id host == actor host) can
 * silently kill discovery ecosystem-wide. This vector is byte-frozen against the
 * proven live `/ap/users/nate` actor shape; a change here that is not intentional
 * is a federation break, not a test to "fix".
 */

/** A media resolver that returns fixed absolute CDN URLs (avatar png, banner jpg). */
const media: ActorMediaResolver = {
  resolveAvatar: (ref) => (ref === 'avatar-file-id' ? 'https://cloud.oxy.so/media/nate-avatar.png' : undefined),
  resolveBanner: (ref) => (ref === 'banner-file-id' ? 'https://cloud.oxy.so/media/nate-banner.jpg' : undefined),
};

const buildActor = createLocalActorBuilder({
  domain: 'mention.earth',
  urls: createUrlBuilders('mention.earth'),
  media,
});

const PUBLIC_KEY_PEM =
  '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA\n-----END PUBLIC KEY-----\n';

const PARAMS = {
  username: 'nate',
  displayName: 'Nate',
  bio: 'building the fediverse',
  avatar: 'avatar-file-id',
  profileHeaderImage: 'banner-file-id',
  publicKey: {
    keyId: 'https://mention.earth/ap/users/nate#main-key',
    publicKeyPem: PUBLIC_KEY_PEM,
  },
  createdAt: '2023-01-15T10:30:00.000Z',
} as const;

/**
 * The frozen expected actor, in the EXACT key order the builder emits. `toEqual`
 * checks values; the `JSON.stringify` string check locks the serialization order.
 */
const EXPECTED_ACTOR: Record<string, unknown> = {
  id: 'https://mention.earth/ap/users/nate',
  type: 'Person',
  preferredUsername: 'nate',
  name: 'Nate',
  summary: 'building the fediverse',
  url: 'https://mention.earth/@nate',
  inbox: 'https://mention.earth/ap/users/nate/inbox',
  outbox: 'https://mention.earth/ap/users/nate/outbox',
  featured: 'https://mention.earth/ap/users/nate/collections/featured',
  followers: 'https://mention.earth/ap/users/nate/followers',
  following: 'https://mention.earth/ap/users/nate/following',
  endpoints: { sharedInbox: 'https://mention.earth/ap/inbox' },
  discoverable: true,
  manuallyApprovesFollowers: false,
  icon: { type: 'Image', url: 'https://cloud.oxy.so/media/nate-avatar.png', mediaType: 'image/png' },
  image: { type: 'Image', url: 'https://cloud.oxy.so/media/nate-banner.jpg', mediaType: 'image/jpeg' },
  publicKey: {
    id: 'https://mention.earth/ap/users/nate#main-key',
    owner: 'https://mention.earth/ap/users/nate',
    publicKeyPem: PUBLIC_KEY_PEM,
  },
  published: '2023-01-15T10:30:00.000Z',
};

describe('createLocalActorBuilder (golden actor vector)', () => {
  it('emits the byte-identical Person actor for a fixed user', () => {
    const actor = buildActor(PARAMS);
    expect(actor).toEqual(EXPECTED_ACTOR);
    // Byte-identity: the serialized bytes (key order included) must match exactly.
    expect(JSON.stringify(actor)).toBe(JSON.stringify(EXPECTED_ACTOR));
  });

  it('serves the byte-identical document once wrapped in the route @context', () => {
    const served = { '@context': AP_CONTEXT, ...buildActor(PARAMS) };
    expect(JSON.stringify(served)).toBe(JSON.stringify({ '@context': AP_CONTEXT, ...EXPECTED_ACTOR }));
    // publicKey.id host MUST equal the actor id host (Mastodon rejects a cross-domain key).
    const key = served.publicKey as { id: string };
    expect(new URL(key.id).host).toBe(new URL(served.id as string).host);
  });

  it('pins the load-bearing @context term declarations', () => {
    expect(AP_CONTEXT[0]).toBe('https://www.w3.org/ns/activitystreams');
    expect(AP_CONTEXT[1]).toBe('https://w3id.org/security/v1');
    expect(AP_CONTEXT[2]).toMatchObject({
      sensitive: 'as:sensitive',
      toot: 'http://joinmastodon.org/ns#',
      votersCount: 'toot:votersCount',
      quote: { '@id': 'https://w3id.org/fep/044f#quote', '@type': '@id' },
    });
  });

  it('omits icon/image (but keeps the account valid) when media does not resolve to an absolute URL', () => {
    const warnings: string[] = [];
    const strictBuilder = createLocalActorBuilder({
      domain: 'mention.earth',
      urls: createUrlBuilders('mention.earth'),
      media: { resolveAvatar: () => undefined, resolveBanner: () => 'not-an-absolute-url' },
      onWarn: (m) => warnings.push(m),
    });
    const actor = strictBuilder({ ...PARAMS, avatar: null, profileHeaderImage: 'y' });
    expect(actor.icon).toBeUndefined();
    expect(actor.image).toBeUndefined();
    // A non-absolute banner is warned; an absent avatar is not (nothing to resolve).
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Omitting actor image');
    expect(JSON.stringify(actor)).not.toContain('"icon"');
    expect(JSON.stringify(actor)).not.toContain('"image"');
  });
});

describe('createUrlBuilders', () => {
  it('scopes actor() to actorDomain and the rest to domain', () => {
    const urls = createUrlBuilders('mention.earth', 'actors.mention.earth');
    expect(urls.actor('nate')).toBe('https://actors.mention.earth/ap/users/nate');
    expect(urls.inbox('nate')).toBe('https://mention.earth/ap/users/nate/inbox');
    expect(urls.sharedInbox()).toBe('https://mention.earth/ap/inbox');
  });
});
