// react must stay a SINGLE instance across jest.resetModules() — the hook module is
// reloaded per test to reset its module-level session state (start memo, busy flag,
// pending release), and a second `react` copy in the fresh registry would break
// renderHook's dispatcher. The mock memoizes the first real load and returns it for
// every registry.
let mockReactSingleton: typeof import('react') | null = null;
jest.mock('react', () => {
  if (!mockReactSingleton) {
    mockReactSingleton = jest.requireActual<typeof import('react')>('react');
  }
  return mockReactSingleton;
});

const mockStart = jest.fn(async () => undefined);
const mockIsSupported = jest.fn(async () => true);
const mockRequestTechnology = jest.fn(async () => undefined);
const mockGetTag = jest.fn();
const mockCancel = jest.fn(async () => undefined);
const mockDecodePayload = jest.fn(() => 'oxycommons://attest?payload=abc');

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    start: () => mockStart(),
    isSupported: () => mockIsSupported(),
    requestTechnology: (tech: unknown) => mockRequestTechnology(tech),
    getTag: () => mockGetTag(),
    cancelTechnologyRequest: () => mockCancel(),
  },
  NfcTech: { Ndef: 'Ndef' },
  Ndef: { uri: { decodePayload: (bytes: Uint8Array) => mockDecodePayload(bytes) } },
}));

// Loaded via requireActual (not an ES import) so it runs AFTER mockReactSingleton is
// initialized — an ES import would trigger the hoisted react mock factory in the TDZ.
const { renderHook, waitFor } = jest.requireActual<typeof import('@testing-library/react')>(
  '@testing-library/react',
);

const URI = 'oxycommons://attest?payload=abc';

type UseNfcReaderModule = typeof import('@/hooks/nfc/useNfcReader');

/** Loads a fresh copy of the hook from the post-reset registry (module state zeroed). */
async function loadUseNfcReader(): Promise<UseNfcReaderModule['useNfcReader']> {
  const mod: UseNfcReaderModule = await import('@/hooks/nfc/useNfcReader');
  return mod.useNfcReader;
}

const flushAsync = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe('useNfcReader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('reports availability from isSupported', async () => {
    const useNfcReader = await loadUseNfcReader();
    const { result } = renderHook(() => useNfcReader());
    await waitFor(() => expect(result.current.available).toBe(true));
  });

  it('reads one NDEF URI record and always releases the technology', async () => {
    mockGetTag.mockResolvedValue({ ndefMessage: [{ payload: [1, 2, 3] }] });
    const useNfcReader = await loadUseNfcReader();
    const { result } = renderHook(() => useNfcReader());
    const read = await result.current.readOnce();
    expect(read).toEqual({ ok: true, uri: URI });
    expect(mockCancel).toHaveBeenCalled();
  });

  it('returns empty for a tag with no NDEF payload', async () => {
    mockGetTag.mockResolvedValue({ ndefMessage: [] });
    const useNfcReader = await loadUseNfcReader();
    const { result } = renderHook(() => useNfcReader());
    const read = await result.current.readOnce();
    expect(read).toEqual({ ok: false, reason: 'empty' });
    expect(mockCancel).toHaveBeenCalled();
  });

  it('returns cancelled when the session throws (user dismissed)', async () => {
    mockRequestTechnology.mockRejectedValueOnce(new Error('cancelled'));
    const useNfcReader = await loadUseNfcReader();
    const { result } = renderHook(() => useNfcReader());
    const read = await result.current.readOnce();
    expect(read).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockCancel).toHaveBeenCalled();
  });

  it('retries NfcManager.start after a failed first start', async () => {
    mockStart.mockRejectedValueOnce(new Error('nfc start failed'));
    mockGetTag.mockResolvedValue({ ndefMessage: [{ payload: [1, 2, 3] }] });
    const useNfcReader = await loadUseNfcReader();
    const { result } = renderHook(() => useNfcReader());

    const first = await result.current.readOnce();
    expect(first).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockStart).toHaveBeenCalledTimes(1);

    const second = await result.current.readOnce();
    expect(mockStart).toHaveBeenCalledTimes(2);
    expect(second).toEqual({ ok: true, uri: URI });
  });

  it('rejects a concurrent readOnce while a session is in flight', async () => {
    mockGetTag.mockResolvedValue({ ndefMessage: [{ payload: [1, 2, 3] }] });
    const useNfcReader = await loadUseNfcReader();
    const { result } = renderHook(() => useNfcReader());

    const first = result.current.readOnce();
    const second = result.current.readOnce();

    await expect(second).resolves.toEqual({ ok: false, reason: 'cancelled' });
    await expect(first).resolves.toEqual({ ok: true, uri: URI });
    expect(mockRequestTechnology).toHaveBeenCalledTimes(1);
    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('serializes a new read behind the previous session release', async () => {
    mockGetTag.mockResolvedValue({ ndefMessage: [{ payload: [1, 2, 3] }] });
    let releasePreviousSession: () => void = () => undefined;
    mockCancel.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          releasePreviousSession = () => resolve(undefined);
        }),
    );
    const useNfcReader = await loadUseNfcReader();
    const { result } = renderHook(() => useNfcReader());

    await result.current.readOnce();
    expect(mockRequestTechnology).toHaveBeenCalledTimes(1);

    const second = result.current.readOnce();
    await flushAsync();
    // The previous session's teardown is still pending — no new technology request yet.
    expect(mockRequestTechnology).toHaveBeenCalledTimes(1);

    releasePreviousSession();
    await expect(second).resolves.toEqual({ ok: true, uri: URI });
    expect(mockRequestTechnology).toHaveBeenCalledTimes(2);
  });
});
