/**
 * `userService.enrichAvatarUrls` — resolved `avatarUrl` stamping.
 *
 * Locks the canonical avatar-URL contract on user DTOs:
 *   - an Oxy file-id avatar → the public CDN (`cloud.oxy.so`) URL from the
 *     batched, S3-HEAD-free resolver;
 *   - an absolute http(s) avatar (federated mirror) → passed through verbatim;
 *   - no avatar / unresolved (private) → `avatarUrl` absent;
 *   - the batched resolver is called ONCE for the whole list (no N+1), and is
 *     handed only bare file ids (absolute-URL avatars are not looked up).
 *
 * `assetServiceSingleton` is stubbed at the module boundary so the test never
 * touches Mongo or S3.
 */

// The global mongoose mock (jest.setup.cjs) does not expose schema methods that
// the real User model uses at import time. Restore the REAL mongoose so
// importing `user.service` (→ the User model) evaluates cleanly.
jest.mock('mongoose', () => jest.requireActual('mongoose'));

const mockResolvePublicAvatarUrls = jest.fn();

jest.mock('../assetServiceSingleton', () => ({
  assetService: {
    resolvePublicAvatarUrls: (...args: unknown[]) => mockResolvePublicAvatarUrls(...args),
  },
  s3Service: {},
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

import { userService } from '../user.service';
import type { PublicUserProfile } from '../../types/user.types';

const CDN_THUMB = 'https://cloud.oxy.so/variants/2026/03/bb/abc/thumb.webp';

function profile(partial: Partial<PublicUserProfile>): PublicUserProfile {
  return {
    id: partial.id ?? 'u',
    name: { displayName: 'User' },
    ...partial,
  } as PublicUserProfile;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('userService.enrichAvatarUrls', () => {
  it('stamps the CDN url for a file-id avatar', async () => {
    mockResolvePublicAvatarUrls.mockResolvedValue(new Map([['file_1', CDN_THUMB]]));

    const [out] = await userService.enrichAvatarUrls([
      profile({ id: 'u1', avatar: 'file_1' }),
    ]);

    expect(out.avatarUrl).toBe(CDN_THUMB);
    // Only the bare file id was handed to the resolver.
    expect(mockResolvePublicAvatarUrls).toHaveBeenCalledTimes(1);
    expect(mockResolvePublicAvatarUrls).toHaveBeenCalledWith(['file_1']);
  });

  it('passes an absolute-URL avatar through verbatim and never looks it up', async () => {
    mockResolvePublicAvatarUrls.mockResolvedValue(new Map());
    const remote = 'https://mastodon.example/avatars/123.png';

    const [out] = await userService.enrichAvatarUrls([
      profile({ id: 'u2', avatar: remote }),
    ]);

    expect(out.avatarUrl).toBe(remote);
    // Absolute-URL avatars are NOT passed to the file-id resolver.
    expect(mockResolvePublicAvatarUrls).toHaveBeenCalledWith([]);
  });

  it('leaves avatarUrl absent for no-avatar and unresolved (private) avatars', async () => {
    // file_private resolves to nothing (private / not public).
    mockResolvePublicAvatarUrls.mockResolvedValue(new Map());

    const [noAvatar, privateAvatar] = await userService.enrichAvatarUrls([
      profile({ id: 'u3' }),
      profile({ id: 'u4', avatar: 'file_private' }),
    ]);

    expect(noAvatar.avatarUrl).toBeUndefined();
    expect(privateAvatar.avatarUrl).toBeUndefined();
  });

  it('resolves a mixed list with a SINGLE batched lookup (no N+1)', async () => {
    mockResolvePublicAvatarUrls.mockResolvedValue(
      new Map([
        ['file_1', CDN_THUMB],
        ['file_2', 'https://cloud.oxy.so/variants/2026/06/cd/xyz/thumb.webp'],
      ])
    );
    const remote = 'https://remote.example/a.png';

    const out = await userService.enrichAvatarUrls([
      profile({ id: 'a', avatar: 'file_1' }),
      profile({ id: 'b', avatar: remote }),
      profile({ id: 'c', avatar: 'file_2' }),
      profile({ id: 'd' }),
    ]);

    expect(mockResolvePublicAvatarUrls).toHaveBeenCalledTimes(1);
    // Only the two bare file ids were collected for the lookup.
    expect(mockResolvePublicAvatarUrls).toHaveBeenCalledWith(['file_1', 'file_2']);
    expect(out[0].avatarUrl).toBe(CDN_THUMB);
    expect(out[1].avatarUrl).toBe(remote);
    expect(out[2].avatarUrl).toBe('https://cloud.oxy.so/variants/2026/06/cd/xyz/thumb.webp');
    expect(out[3].avatarUrl).toBeUndefined();
  });

  it('short-circuits an empty list without calling the resolver', async () => {
    const out = await userService.enrichAvatarUrls([]);
    expect(out).toEqual([]);
    expect(mockResolvePublicAvatarUrls).not.toHaveBeenCalled();
  });
});
