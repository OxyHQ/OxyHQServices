/**
 * Tests the optimistic-upload lifecycle in `useFileUploadState`, pinning Bug 2
 * (the `temp-` id leak):
 *
 *  - While an upload is in flight, the optimistic entry carries the LOCALLY
 *    PICKED uri as its preview and is flagged `uploading` — so the grid renders
 *    the picked image and never builds an asset URL from the `temp-…` id.
 *  - On success with a file payload, the optimistic entry is replaced by the
 *    real persisted file (its `temp-…` id disappears).
 *  - On success WITHOUT a file payload, the optimistic entry is reconciled
 *    (removed) rather than stranded with a `temp-…` id forever.
 *
 * The document picker is stubbed; every other helper is the real module so the
 * store transitions under test are exercised end to end.
 */

import { renderHook, act } from '@testing-library/react';
import { Platform } from 'react-native';
import { useFileStore } from '../../src/ui/stores/fileStore';
import { fileThumbSource } from '../../src/ui/hooks/useResolvedFileUrls';
import type { useUploadFile } from '../../src/ui/hooks/mutations/useAccountMutations';

// Keep every real helper; only stub the lazy document-picker loader.
const getDocumentAsync = jest.fn();
jest.mock('../../src/ui/screens/fileManagement/shared', () => {
  const actual = jest.requireActual('../../src/ui/screens/fileManagement/shared');
  return { __esModule: true, ...actual, loadDocumentPicker: () => Promise.resolve({ getDocumentAsync }) };
});

import { useFileUploadState } from '../../src/ui/screens/fileManagement/hooks/useFileUploadState';

const PICKED_URI = 'file:///picked-photo.png';

type UploadMutation = ReturnType<typeof useUploadFile>;

const makeParams = (mutateAsync: jest.Mock) => ({
  targetUserId: 'u1',
  uploadFileMutation: { mutateAsync } as unknown as UploadMutation,
  defaultVisibility: 'private' as const,
  selectMode: false,
  multiSelect: false,
  afterSelect: 'none' as const,
  onSelect: jest.fn(),
  goBack: jest.fn(),
  onClose: jest.fn(),
  selectedIds: new Set<string>(),
  setSelectedIds: jest.fn(),
  loadFiles: jest.fn(),
  t: (key: string) => key,
});

const primePicker = () => {
  getDocumentAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: PICKED_URI, name: 'picked-photo.png', mimeType: 'image/png', size: 2048 }],
  });
};

const tempEntries = () =>
  Object.values(useFileStore.getState().files).filter((f) => f.id.startsWith('temp-'));

describe('useFileUploadState optimistic lifecycle', () => {
  const originalOS = Platform.OS;

  beforeEach(() => {
    // Native path in convertDocumentPickerAssetToFile returns the descriptor
    // directly (no web fetch/Blob), which keeps this test hermetic.
    Platform.OS = 'ios';
    useFileStore.getState().reset();
    getDocumentAsync.mockReset();
    primePicker();
  });

  afterEach(() => {
    Platform.OS = originalOS;
    useFileStore.getState().reset();
  });

  it('shows the picked uri (never a temp asset URL) while uploading, then removes the temp entry when the response has no file payload', async () => {
    let resolveUpload: (value: unknown) => void = () => undefined;
    const mutateAsync = jest.fn(() => new Promise((resolve) => { resolveUpload = resolve; }));

    const { result } = renderHook(() => useFileUploadState(makeParams(mutateAsync)));

    await act(async () => {
      await result.current.handleFileUpload();
    });

    let confirmPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      confirmPromise = result.current.handleConfirmUpload();
      // let the optimistic addFile + mutateAsync call run up to the await
      await Promise.resolve();
    });

    // In flight: exactly one optimistic entry, flagged + carrying the picked uri.
    const inFlight = tempEntries();
    expect(inFlight).toHaveLength(1);
    const optimistic = inFlight[0];
    expect(optimistic.metadata?.uploading).toBe(true);
    expect((optimistic.metadata as { localPreviewUri?: string }).localPreviewUri).toBe(PICKED_URI);
    // The grid source for the optimistic entry is the picked uri — NOT an asset
    // URL built from its temp- id (the resolved map is intentionally empty).
    expect(fileThumbSource(optimistic, new Map())).toBe(PICKED_URI);

    // Upload succeeds but returns no file payload.
    await act(async () => {
      resolveUpload({});
      await confirmPromise;
    });

    // Reconciled: no stranded temp- entry remains.
    expect(tempEntries()).toHaveLength(0);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('replaces the optimistic entry with the persisted file on success', async () => {
    const mutateAsync = jest.fn(async () => ({
      file: {
        id: 'real-42',
        originalName: 'picked-photo.png',
        mime: 'image/png',
        size: 2048,
        createdAt: '2026-01-02T00:00:00.000Z',
        metadata: {},
        variants: [],
      },
    }));

    const { result } = renderHook(() => useFileUploadState(makeParams(mutateAsync)));

    await act(async () => {
      await result.current.handleFileUpload();
    });
    await act(async () => {
      await result.current.handleConfirmUpload();
    });

    const files = Object.values(useFileStore.getState().files);
    expect(files.some((f) => f.id.startsWith('temp-'))).toBe(false);
    expect(files.some((f) => f.id === 'real-42')).toBe(true);
  });
});
