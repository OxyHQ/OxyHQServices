jest.mock('../logger', () => ({ logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() } }));
import { initializeIO, closeIO, broadcastDeviceState } from '../socket';
import type { DeviceSessionState } from '@oxyhq/contracts';

const state: DeviceSessionState = { deviceId: 'd1', accounts: [], activeAccountId: null, revision: 5, updatedAt: 1720000000000 };

afterEach(() => closeIO());

describe('broadcastDeviceState', () => {
  it('emits session_state to the device room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    initializeIO({ to } as never);
    broadcastDeviceState(state);
    expect(to).toHaveBeenCalledWith('device:d1');
    expect(emit).toHaveBeenCalledWith('session_state', state);
  });

  it('is a no-op when io is not initialised', () => {
    closeIO();
    expect(() => broadcastDeviceState(state)).not.toThrow();
  });
});
