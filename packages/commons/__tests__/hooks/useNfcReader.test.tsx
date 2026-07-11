import { renderHook, waitFor } from '@testing-library/react';

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

// eslint-disable-next-line import/first
import { useNfcReader } from '@/hooks/nfc/useNfcReader';

describe('useNfcReader', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reports availability from isSupported', async () => {
    const { result } = renderHook(() => useNfcReader());
    await waitFor(() => expect(result.current.available).toBe(true));
  });

  it('reads one NDEF URI record and always releases the technology', async () => {
    mockGetTag.mockResolvedValue({ ndefMessage: [{ payload: [1, 2, 3] }] });
    const { result } = renderHook(() => useNfcReader());
    const read = await result.current.readOnce();
    expect(read).toEqual({ ok: true, uri: 'oxycommons://attest?payload=abc' });
    expect(mockCancel).toHaveBeenCalled();
  });

  it('returns empty for a tag with no NDEF payload', async () => {
    mockGetTag.mockResolvedValue({ ndefMessage: [] });
    const { result } = renderHook(() => useNfcReader());
    const read = await result.current.readOnce();
    expect(read).toEqual({ ok: false, reason: 'empty' });
    expect(mockCancel).toHaveBeenCalled();
  });

  it('returns cancelled when the session throws (user dismissed)', async () => {
    mockRequestTechnology.mockRejectedValueOnce(new Error('cancelled'));
    const { result } = renderHook(() => useNfcReader());
    const read = await result.current.readOnce();
    expect(read).toEqual({ ok: false, reason: 'cancelled' });
    expect(mockCancel).toHaveBeenCalled();
  });
});
