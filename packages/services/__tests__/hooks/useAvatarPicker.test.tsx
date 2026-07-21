/**
 * `useAvatarPicker` (P4) — the avatar flow now runs on typed promises over the
 * shared surface stack instead of `onSelect`/`onConfirm` callback props threaded
 * through `showBottomSheet`.
 *
 * These pin the orchestration:
 *   1. present('FileManagement') resolves with the picked file → its source URL
 *      is resolved → present('AvatarCrop') resolves with the cropped JPEG →
 *      the crop is uploaded and set as the avatar.
 *   2. Cancelling the picker (present resolves `undefined`) aborts before any
 *      URL resolve / crop.
 *   3. Cancelling the crop aborts before any upload.
 *   4. A non-image pick surfaces an error and never opens the crop editor.
 */

import { renderHook, act } from '@testing-library/react';
import type { FileMetadata } from '@oxyhq/core';

// Control what the SDK surface layer's present() resolves with per route.
const present = jest.fn<Promise<unknown>, [string, ...unknown[]]>();
jest.mock('../../src/ui/navigation/surfaces', () => ({
  surfaces: { present: (route: string, ...rest: unknown[]) => present(route, ...rest) },
}));

// Avatar-set path is asserted, not exercised for real.
const updateProfileWithAvatar = jest.fn().mockResolvedValue(undefined);
jest.mock('../../src/ui/utils/avatarUtils', () => ({
  updateProfileWithAvatar: (...args: unknown[]) => updateProfileWithAvatar(...args),
}));

// Minimal core surface used by the hook (types are erased at runtime).
const updateAvatarVisibility = jest.fn().mockResolvedValue(undefined);
jest.mock('@oxyhq/core', () => ({
  translate: (_lang: string | undefined, key: string) => key,
  updateAvatarVisibility: (...args: unknown[]) => updateAvatarVisibility(...args),
}));

import { toast } from '@oxyhq/bloom';
import { useAvatarPicker } from '../../src/ui/hooks/useAvatarPicker';

const imageFile: FileMetadata = {
  id: 'file-1',
  filename: 'pic.png',
  contentType: 'image/png',
  length: 1024,
  chunkSize: 0,
  uploadDate: '2026-01-01T00:00:00.000Z',
  metadata: {},
} as FileMetadata;

const croppedResult = { uri: 'file:///cropped.jpg', width: 512, height: 512, mime: 'image/jpeg' as const };

const makeOxyServices = () => ({
  assetGetUrl: jest.fn().mockResolvedValue({ url: 'https://cdn.example/pic.png' }),
  assetUpload: jest.fn().mockResolvedValue({ id: 'uploaded-1' }),
});

const renderPicker = (oxyServices: ReturnType<typeof makeOxyServices>) =>
  renderHook(() =>
    useAvatarPicker({
      // Only the two async methods are touched by the hook.
      oxyServices: oxyServices as never,
      currentLanguage: 'en-US',
      activeSessionId: 'session-1',
      queryClient: {} as never,
    }),
  );

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAvatarPicker', () => {
  it('picks → resolves URL → crops → uploads → sets avatar', async () => {
    present.mockImplementation((route) =>
      route === 'FileManagement'
        ? Promise.resolve(imageFile)
        : route === 'AvatarCrop'
          ? Promise.resolve(croppedResult)
          : Promise.resolve(undefined),
    );
    const oxyServices = makeOxyServices();
    const { result } = renderPicker(oxyServices);

    await act(async () => {
      await result.current.openAvatarPicker();
    });

    // FileManagement was presented in image-only single-select picker mode.
    expect(present).toHaveBeenNthCalledWith(1, 'FileManagement', {
      selectMode: true,
      multiSelect: false,
      disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
    });
    expect(oxyServices.assetGetUrl).toHaveBeenCalledWith('file-1');
    // AvatarCrop was presented with the resolved private-safe source URL.
    expect(present).toHaveBeenNthCalledWith(2, 'AvatarCrop', {
      imageUri: 'https://cdn.example/pic.png',
    });
    expect(oxyServices.assetUpload).toHaveBeenCalledTimes(1);
    expect(updateProfileWithAvatar).toHaveBeenCalledWith(
      { avatar: 'uploaded-1' },
      expect.anything(),
      'session-1',
      expect.anything(),
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('aborts when the picker is cancelled (no url resolve, no crop)', async () => {
    present.mockResolvedValue(undefined);
    const oxyServices = makeOxyServices();
    const { result } = renderPicker(oxyServices);

    await act(async () => {
      await result.current.openAvatarPicker();
    });

    expect(present).toHaveBeenCalledTimes(1);
    expect(oxyServices.assetGetUrl).not.toHaveBeenCalled();
    expect(oxyServices.assetUpload).not.toHaveBeenCalled();
    expect(updateProfileWithAvatar).not.toHaveBeenCalled();
  });

  it('aborts when the crop is cancelled (no upload)', async () => {
    present.mockImplementation((route) =>
      route === 'FileManagement' ? Promise.resolve(imageFile) : Promise.resolve(undefined),
    );
    const oxyServices = makeOxyServices();
    const { result } = renderPicker(oxyServices);

    await act(async () => {
      await result.current.openAvatarPicker();
    });

    expect(present).toHaveBeenCalledTimes(2);
    expect(oxyServices.assetGetUrl).toHaveBeenCalledTimes(1);
    expect(oxyServices.assetUpload).not.toHaveBeenCalled();
    expect(updateProfileWithAvatar).not.toHaveBeenCalled();
  });

  it('rejects a non-image pick with an error and never opens the crop editor', async () => {
    const textFile = { ...imageFile, contentType: 'text/plain' } as FileMetadata;
    present.mockImplementation((route) =>
      route === 'FileManagement' ? Promise.resolve(textFile) : Promise.resolve(undefined),
    );
    const oxyServices = makeOxyServices();
    const { result } = renderPicker(oxyServices);

    await act(async () => {
      await result.current.openAvatarPicker();
    });

    expect(present).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalled();
    expect(oxyServices.assetGetUrl).not.toHaveBeenCalled();
    expect(oxyServices.assetUpload).not.toHaveBeenCalled();
  });
});
