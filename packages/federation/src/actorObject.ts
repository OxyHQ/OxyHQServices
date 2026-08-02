/**
 * The single builder of a LOCAL user's ActivityPub `Person` actor document.
 *
 * Shared by the GET actor route (which serves it as a standalone JSON-LD
 * document) and the outbound `Update(Person)` broadcast (which embeds it in an
 * `Update` activity), so a follower's Mastodon renders the same actor whether it
 * was fetched or pushed. Deliberately does NOT include the top-level `@context`:
 * the GET route and the `Update` envelope each own their JSON-LD context, and an
 * embedded actor object must not double-declare it.
 *
 * The exact bytes of this document are load-bearing — Mastodon negative-caches a
 * malformed actor — so the field set, ordering, and the absolute-URL invariant on
 * `icon`/`image` must stay byte-identical across every app that uses the engine.
 *
 * Media resolution is injected ({@link ActorMediaResolver}): the engine holds no
 * knowledge of any app's media pipeline. The app resolves an avatar/banner
 * reference (Oxy file id or URL) to a final absolute URL; the engine enforces the
 * absolute-URL invariant and assembles the AP `Image` object.
 */

import type { UrlBuilders } from './urls';

/** Map common image extensions to a MIME type for an actor image `mediaType`. */
const IMAGE_MEDIA_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
};

/** True when `value` is an absolute `http(s)` URL. */
function isAbsoluteHttpUrl(value: string): boolean {
  try {
    return /^https?:$/i.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Build an ActivityPub `Image` object from an already-absolute URL, deriving
 * `mediaType` from the URL extension when recognizable (a bare `Image` with a
 * `url` is spec-valid, so an unknown extension simply omits `mediaType` rather
 * than asserting a wrong one). Shared by the actor `icon` (avatar) and `image`
 * (profile banner) builders.
 */
function apImageObject(url: string): { type: 'Image'; url: string; mediaType?: string } {
  let extension: string | undefined;
  try {
    extension = new URL(url).pathname.split('.').pop()?.toLowerCase();
  } catch {
    extension = url.split('?')[0]?.split('.').pop()?.toLowerCase();
  }
  const mediaType = extension ? IMAGE_MEDIA_TYPE_BY_EXT[extension] : undefined;
  return mediaType ? { type: 'Image', url, mediaType } : { type: 'Image', url };
}

/**
 * App-supplied media resolution for the actor `icon`/`image`. Each function
 * resolves a stored reference (Oxy file id or URL) to a FINAL, ready-to-serve
 * URL, or a falsy value when there is nothing to resolve. The engine enforces the
 * absolute-URL invariant on the result.
 */
export interface ActorMediaResolver {
  /** Resolve the avatar reference to an absolute URL (actor `icon`). */
  resolveAvatar(ref: string): string | null | undefined;
  /** Resolve the banner reference to an absolute URL (actor `image`). */
  resolveBanner(ref: string): string | null | undefined;
}

/** Adapters + domain config a {@link LocalActorBuilder} is built from. */
export interface LocalActorBuilderConfig {
  /** The app's federation domain — the host of the actor's human-facing `url`. */
  domain: string;
  /** The per-instance URL builders (actor/inbox/outbox/collections). */
  urls: UrlBuilders;
  /** App-supplied avatar/banner resolution. */
  media: ActorMediaResolver;
  /** Optional sink for the non-fatal "did not resolve to an absolute URL" warning. */
  onWarn?: (message: string) => void;
}

/** Per-user inputs to a {@link LocalActorBuilder}. */
export interface BuildLocalActorParams {
  username: string;
  /**
   * The caller-resolved Oxy `name.displayName` (falling back to the handle). Never
   * recomposed from name parts here.
   */
  displayName: string;
  bio?: string | null;
  /** The avatar reference (Oxy file id or URL); resolved to the actor `icon`. */
  avatar?: string | null;
  /**
   * The banner reference (from the app's own settings, e.g.
   * `UserSettings.profileHeaderImage`); resolved to the actor `image`.
   */
  profileHeaderImage?: string | null;
  publicKey: { keyId: string; publicKeyPem: string };
  createdAt?: string | null;
}

/** Assembles a LOCAL user's AP `Person` actor object (WITHOUT the top-level `@context`). */
export type LocalActorBuilder = (params: BuildLocalActorParams) => Record<string, unknown>;

/**
 * Build the actor `icon` (avatar) object, enforcing the absolute-URL invariant.
 *
 * ActivityPub consumers such as Mastodon validate that `icon.url` is an absolute
 * URL and REJECT the entire actor document when it is not — so a non-absolute
 * value makes the account undiscoverable. Returns undefined when there is no
 * avatar or no absolute URL can be produced (Mastodon is fine with an
 * avatar-less actor).
 */
function buildActorIcon(
  config: LocalActorBuilderConfig,
  avatar: string | null | undefined,
): { type: 'Image'; url: string; mediaType?: string } | undefined {
  if (!avatar) return undefined;
  const resolved = config.media.resolveAvatar(avatar);
  if (!resolved || !isAbsoluteHttpUrl(resolved)) {
    config.onWarn?.(`[Federation] Omitting actor icon — avatar did not resolve to an absolute URL (ref: ${avatar})`);
    return undefined;
  }
  return apImageObject(resolved);
}

/**
 * Build the actor `image` (profile banner/header) object, enforcing the same
 * absolute-URL invariant as {@link buildActorIcon}. Mastodon renders the AP
 * `image` property as the profile HEADER banner.
 */
function buildActorImage(
  config: LocalActorBuilderConfig,
  banner: string | null | undefined,
): { type: 'Image'; url: string; mediaType?: string } | undefined {
  if (!banner) return undefined;
  const resolved = config.media.resolveBanner(banner);
  if (!resolved || !isAbsoluteHttpUrl(resolved)) {
    config.onWarn?.(`[Federation] Omitting actor image — banner did not resolve to an absolute URL (ref: ${banner})`);
    return undefined;
  }
  return apImageObject(resolved);
}

/**
 * Build the per-instance local-actor builder. Bind it once with an app's domain +
 * media resolver; call the returned function per user.
 */
export function createLocalActorBuilder(config: LocalActorBuilderConfig): LocalActorBuilder {
  return (params: BuildLocalActorParams): Record<string, unknown> => {
    const { username, displayName, bio, avatar, profileHeaderImage, publicKey, createdAt } = params;

    const actorObject: Record<string, unknown> = {
      id: config.urls.actor(username),
      type: 'Person',
      preferredUsername: username,
      name: displayName,
      summary: bio || '',
      url: `https://${config.domain}/@${username}`,
      inbox: config.urls.inbox(username),
      outbox: config.urls.outbox(username),
      featured: config.urls.featured(username),
      followers: config.urls.followers(username),
      following: config.urls.following(username),
      endpoints: { sharedInbox: config.urls.sharedInbox() },
      discoverable: true,
      manuallyApprovesFollowers: false,
      icon: buildActorIcon(config, avatar),
      image: buildActorImage(config, profileHeaderImage),
      publicKey: {
        id: publicKey.keyId,
        owner: config.urls.actor(username),
        publicKeyPem: publicKey.publicKeyPem,
      },
    };

    // `published` (account creation date) is advertised when the API provides it.
    if (createdAt) {
      actorObject.published = new Date(createdAt).toISOString();
    }

    return actorObject;
  };
}
