/**
 * `ChangeAvatarScreen` — the source list that is the ONE entry into changing a
 * profile picture.
 *
 * The contract these pin:
 *   - every source that yields an image NAVIGATES within this surface to
 *     `AvatarCrop` (never `present`s it), which is what makes the panel morph;
 *   - the camera is offered only where it exists;
 *   - removal is confirmed first, then resolves the surface (this screen writes
 *     nothing — `useAvatarPicker` owns the single write path);
 *   - a refused permission explains itself instead of failing silently.
 */

import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';

// --- expo-image-picker (an OPTIONAL peer, loaded with `await import`) --------
const launchImageLibraryAsync = jest.fn();
const launchCameraAsync = jest.fn();
const requestMediaLibraryPermissionsAsync = jest.fn();
const requestCameraPermissionsAsync = jest.fn();
jest.mock(
  'expo-image-picker',
  () => ({
    __esModule: true,
    launchImageLibraryAsync: (...a: unknown[]) => launchImageLibraryAsync(...a),
    launchCameraAsync: (...a: unknown[]) => launchCameraAsync(...a),
    requestMediaLibraryPermissionsAsync: () => requestMediaLibraryPermissionsAsync(),
    requestCameraPermissionsAsync: () => requestCameraPermissionsAsync(),
  }),
  { virtual: true },
);

// The Oxy-files media selector MORPHS into the caller's surface (a nested
// sub-flow) via `openWithinOrPresent`, and resolves with the picked file.
const openWithinOrPresent = jest.fn<Promise<unknown>, [string, ...unknown[]]>();
jest.mock('../../src/ui/navigation/surfaces', () => ({
  openWithinOrPresent: (route: string, ...rest: unknown[]) => openWithinOrPresent(route, ...rest),
}));

const assetGetUrl = jest.fn();
jest.mock('../../src/ui/context/OxyContext', () => ({
  __esModule: true,
  useOxy: () => ({
    user: { avatar: 'file-current', username: 'nate' },
    oxyServices: {
      getFileDownloadUrl: (id: string) => `https://cdn.example/${id}`,
      assetGetUrl: (...a: unknown[]) => assetGetUrl(...a),
    },
  }),
}));

// Echo the key so assertions read as the contract, not as English copy.
jest.mock('../../src/ui/hooks/useI18n', () => ({
  __esModule: true,
  useI18n: () => ({ t: (key: string) => key, locale: 'en-US' }),
}));

jest.mock('../../src/ui/hooks/useSurfaceHeader', () => ({
  __esModule: true,
  useSurfaceHeader: jest.fn(),
}));

jest.mock('@oxyhq/core', () => ({
  __esModule: true,
  getAccountDisplayName: () => 'Nate',
  logger: { debug: jest.fn(), error: jest.fn() },
}));

// The row icons carry no assertable behaviour and pull in `@expo/vector-icons`,
// which ships untransformed ESM — stubbed rather than transformed.
jest.mock('../../src/ui/components/SettingsIcon', () => ({
  __esModule: true,
  SettingsIcon: () => null,
  default: () => null,
}));

import { Platform } from 'react-native';
import { surfaces as bloomSurfaces, toast } from '@oxyhq/bloom';
import ChangeAvatarScreen from '../../src/ui/screens/ChangeAvatarScreen';

const navigate = jest.fn();
const dismiss = jest.fn();

const renderScreen = () =>
  render(<ChangeAvatarScreen navigate={navigate} dismiss={dismiss} />);

/** Press a source row by its (key-echoed) title. */
const pressRow = async (titleKey: string) => {
  await act(async () => {
    fireEvent.click(screen.getByText(titleKey).closest('button') as HTMLButtonElement);
  });
};

/** The source keys the screen currently offers, in render order. */
const renderedSources = (): string[] =>
  screen
    .getAllByRole('button')
    .map((node) => node.textContent ?? '')
    .filter((text) => text.startsWith('changeAvatar.sources.'))
    .map((text) => text.split('changeAvatar.sources.')[1]?.split('.')[0] ?? '');

beforeEach(() => {
  jest.clearAllMocks();
  // The stub RN runtime reports `web`; the native cases opt in explicitly.
  Platform.OS = 'ios';
  requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  requestCameraPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
  launchCameraAsync.mockResolvedValue({ canceled: true, assets: null });
});

afterEach(() => {
  Platform.OS = 'web';
});

describe('ChangeAvatarScreen', () => {
  it('offers exactly the four sources, in order', () => {
    renderScreen();
    expect(renderedSources()).toEqual(['upload', 'camera', 'files', 'remove']);
  });

  it('drops the camera on web, where there is no camera surface to open', () => {
    Platform.OS = 'web';
    renderScreen();
    expect(renderedSources()).toEqual(['upload', 'files', 'remove']);
  });

  it('navigates WITHIN the surface to the cropper after a gallery pick', async () => {
    launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///picked.jpg', width: 1200, height: 900 }],
    });
    renderScreen();

    await pressRow('changeAvatar.sources.upload.title');

    // `navigate` (a push, NOT a stacked present) — Cancel on the cropper morphs
    // back here to re-pick; the push is flash-free because the cropper does its
    // own async work.
    expect(openWithinOrPresent).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('AvatarCrop', {
      imageUri: 'file:///picked.jpg',
      // The picker already knows the natural size, so the cropper skips its
      // own measurement round-trip.
      sourceWidth: 1200,
      sourceHeight: 900,
    });
  });

  it('does not move to the cropper when the gallery pick is cancelled', async () => {
    renderScreen();
    await pressRow('changeAvatar.sources.upload.title');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('explains a refused permission instead of failing silently', async () => {
    requestCameraPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    renderScreen();

    await pressRow('changeAvatar.sources.camera.title');

    expect(launchCameraAsync).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('changeAvatar.permission.cameraDenied')).toBeTruthy(),
    );
  });

  it('hands an Oxy file ID straight to the cropper without resolving its URL here', async () => {
    openWithinOrPresent.mockResolvedValue({ id: 'file-9', contentType: 'image/png' });
    renderScreen();

    await pressRow('changeAvatar.sources.files.title');

    expect(openWithinOrPresent).toHaveBeenCalledWith('FileManagement', {
      selectMode: true,
      multiSelect: false,
      disabledMimeTypes: ['video/', 'audio/', 'application/pdf'],
    });
    // The URL is resolved by the cropper (on its own canvas), NOT here — so this
    // list is not left on screen for the round-trip. It only forwards the file ID.
    expect(assetGetUrl).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('AvatarCrop', { imageFileId: 'file-9' });
  });

  it('rejects a non-image Oxy file and never opens the cropper', async () => {
    openWithinOrPresent.mockResolvedValue({ id: 'file-9', contentType: 'text/plain' });
    renderScreen();

    await pressRow('changeAvatar.sources.files.title');

    expect(assetGetUrl).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('editProfile.toasts.selectImage');
  });

  it('confirms before removing, then resolves the surface with the removal', async () => {
    (bloomSurfaces.confirm as jest.Mock).mockResolvedValue(true);
    renderScreen();

    await pressRow('changeAvatar.sources.remove.title');

    expect(bloomSurfaces.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ destructive: true }),
    );
    expect(dismiss).toHaveBeenCalledWith({ removed: true });
  });

  it('does nothing when the removal is declined', async () => {
    (bloomSurfaces.confirm as jest.Mock).mockResolvedValue(false);
    renderScreen();

    await pressRow('changeAvatar.sources.remove.title');

    expect(dismiss).not.toHaveBeenCalled();
  });
});
