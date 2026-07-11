import { renderHook, waitFor, act } from '@testing-library/react';
import { Platform } from 'react-native';

const mockIsSupported = jest.fn(async () => true);
const mockIsEnabled = jest.fn(async () => true);
jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: { isSupported: () => mockIsSupported(), isEnabled: () => mockIsEnabled() },
}));

const mockSetApplication = jest.fn(async () => undefined);
const mockSetEnabled = jest.fn(async () => undefined);
let readListener: (() => void) | null = null;
const mockRemoveListener = jest.fn();
const mockSession = {
  setApplication: mockSetApplication,
  setEnabled: mockSetEnabled,
  on: jest.fn((_event: string, cb: () => void) => {
    readListener = cb;
    return mockRemoveListener;
  }),
};
type MockHceSession = typeof mockSession;
const mockGetInstance = jest.fn(async (): Promise<MockHceSession> => mockSession);
jest.mock('react-native-hce', () => ({
  __esModule: true,
  HCESession: {
    getInstance: () => mockGetInstance(),
    Events: { HCE_STATE_READ: 'hceStateRead' },
  },
  NFCTagType4: jest.fn(function (this: Record<string, unknown>, props: unknown) { this.props = props; }),
  NFCTagType4NDEFContentType: { URL: 'url', Text: 'text' },
}));

// eslint-disable-next-line import/first
import { useNfcAttestEmitter } from '@/hooks/nfc/useNfcAttestEmitter';

const PAYLOAD = 'oxycommons://attest?payload=abc';

describe('useNfcAttestEmitter', () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    jest.clearAllMocks();
    readListener = null;
  });
  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('arms HCE with the payload and reports emitting', async () => {
    const onRead = jest.fn();
    const { result } = renderHook(() => useNfcAttestEmitter({ payload: PAYLOAD, enabled: true, onRead }));
    await waitFor(() => expect(result.current.state).toBe('emitting'));
    expect(mockSetApplication).toHaveBeenCalledTimes(1);
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
  });

  it('fires onRead when the HCE read event arrives', async () => {
    const onRead = jest.fn();
    const { result } = renderHook(() => useNfcAttestEmitter({ payload: PAYLOAD, enabled: true, onRead }));
    await waitFor(() => expect(result.current.state).toBe('emitting'));
    act(() => { readListener?.(); });
    expect(onRead).toHaveBeenCalledTimes(1);
  });

  it('reports off when NFC is disabled in settings', async () => {
    mockIsEnabled.mockResolvedValueOnce(false);
    const { result } = renderHook(() => useNfcAttestEmitter({ payload: PAYLOAD, enabled: true, onRead: jest.fn() }));
    await waitFor(() => expect(result.current.state).toBe('off'));
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it('reports unsupported on iOS and never touches native modules', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { result } = renderHook(() => useNfcAttestEmitter({ payload: PAYLOAD, enabled: true, onRead: jest.fn() }));
    expect(result.current.state).toBe('unsupported');
    expect(mockIsSupported).not.toHaveBeenCalled();
  });

  it('disarms on unmount', async () => {
    const { result, unmount } = renderHook(() => useNfcAttestEmitter({ payload: PAYLOAD, enabled: true, onRead: jest.fn() }));
    await waitFor(() => expect(result.current.state).toBe('emitting'));
    unmount();
    expect(mockRemoveListener).toHaveBeenCalled();
    expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
  });

  it('never arms when unmounted while getInstance is in flight', async () => {
    let resolveGetInstance: ((session: MockHceSession) => void) | null = null;
    mockGetInstance.mockImplementationOnce(
      () => new Promise<MockHceSession>((resolve) => { resolveGetInstance = resolve; }),
    );
    const { unmount } = renderHook(() =>
      useNfcAttestEmitter({ payload: PAYLOAD, enabled: true, onRead: jest.fn() }),
    );
    await waitFor(() => expect(mockGetInstance).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => {
      resolveGetInstance?.(mockSession);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    expect(mockSetApplication).not.toHaveBeenCalled();
    expect(mockSetEnabled).not.toHaveBeenCalled();
  });

  it('converges the radio off when unmounted while setEnabled(true) is pending', async () => {
    let resolveEnable: (() => void) | null = null;
    mockSetEnabled.mockImplementationOnce(
      () => new Promise<undefined>((resolve) => { resolveEnable = () => resolve(undefined); }),
    );
    const { unmount } = renderHook(() =>
      useNfcAttestEmitter({ payload: PAYLOAD, enabled: true, onRead: jest.fn() }),
    );
    await waitFor(() => expect(mockSetEnabled).toHaveBeenCalledWith(true));
    unmount();
    const callsBeforeResolve = mockSetEnabled.mock.calls.length;
    await act(async () => {
      resolveEnable?.();
      await new Promise((resolve) => { setTimeout(resolve, 0); });
    });
    // The late-resuming arm must issue its OWN disarm — cleanup's disarm
    // already landed before our enable resolved, so without the converge
    // call the radio would be left on.
    expect(mockSetEnabled.mock.calls.length).toBeGreaterThan(callsBeforeResolve);
    expect(mockSetEnabled).toHaveBeenLastCalledWith(false);
  });
});
