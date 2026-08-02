/**
 * Guards that KNOWN-PUBLIC avatar assets keep using the SYNCHRONOUS CDN URL
 * (`getFileDownloadUrl`), not the authenticated batch/async path.
 *
 * The private-thumbnail fix routes FileManagement grid tiles through the
 * async batch resolver, but avatars are always public and must continue to
 * resolve via the cheap synchronous CDN URL — this test pins that split so a
 * future refactor doesn't accidentally push avatars onto the private path.
 */

import type { OxyServices } from '@oxyhq/core';
import { refreshAvatarInStore } from '../../src/ui/utils/avatarUtils';
import { useAccountStore } from '../../src/ui/stores/accountStore';

describe('refreshAvatarInStore (public avatar → sync CDN path)', () => {
  it('builds the avatar URL with the synchronous getFileDownloadUrl(thumb)', () => {
    const getFileDownloadUrl = jest.fn(
      (fileId: string, variant?: string) => `https://cloud.oxy.so/${fileId}?variant=${variant}`,
    );
    const getFileDownloadUrlAsync = jest.fn();
    const getFileDownloadUrls = jest.fn();

    // Seed an account (Record keyed by sessionId) so updateAccount has a row.
    useAccountStore.setState({
      accounts: { 'sess-1': { id: 'sess-1', username: 'a' } as never },
    } as never);

    const oxyServices = {
      getFileDownloadUrl,
      getFileDownloadUrlAsync,
      getFileDownloadUrls,
    } as unknown as OxyServices;

    refreshAvatarInStore('sess-1', 'avatar-file-1', oxyServices);

    expect(getFileDownloadUrl).toHaveBeenCalledWith('avatar-file-1', 'thumb');
    // The public avatar path must NOT touch the authenticated resolvers.
    expect(getFileDownloadUrlAsync).not.toHaveBeenCalled();
    expect(getFileDownloadUrls).not.toHaveBeenCalled();
  });
});
