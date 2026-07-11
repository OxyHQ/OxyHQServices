import { renderHook, act } from '@testing-library/react';
import { __emitOxyEvent } from '@/__mocks__/oxyhq-services';
import { useAttestedEvent } from '@/hooks/civic/useAttestedEvent';

describe('useAttestedEvent', () => {
  it('fires the callback for a well-formed civic:attested payload', () => {
    const onAttested = jest.fn();
    renderHook(() => useAttestedEvent(onAttested));
    act(() => {
      __emitOxyEvent('civic:attested', { byUserId: 'u2', recordId: 'r1', points: 25, at: '2026-07-11T00:00:00.000Z' });
    });
    expect(onAttested).toHaveBeenCalledWith({ byUserId: 'u2', recordId: 'r1', points: 25, at: '2026-07-11T00:00:00.000Z' });
  });

  it('ignores malformed payloads (strict whitelist)', () => {
    const onAttested = jest.fn();
    renderHook(() => useAttestedEvent(onAttested));
    act(() => {
      __emitOxyEvent('civic:attested', null);
      __emitOxyEvent('civic:attested', 'nope');
      __emitOxyEvent('civic:attested', { byUserId: 42 });
    });
    expect(onAttested).not.toHaveBeenCalled();
  });

  it('drops payloads missing points/at instead of synthesizing defaults', () => {
    const onAttested = jest.fn();
    renderHook(() => useAttestedEvent(onAttested));
    act(() => {
      __emitOxyEvent('civic:attested', { byUserId: 'u2', recordId: 'r1' });
      __emitOxyEvent('civic:attested', { byUserId: 'u2', recordId: 'r1', points: '25', at: 42 });
    });
    expect(onAttested).not.toHaveBeenCalled();
  });

  it('never reacts to other event names', () => {
    const onAttested = jest.fn();
    renderHook(() => useAttestedEvent(onAttested));
    act(() => {
      __emitOxyEvent('session_removed', { byUserId: 'u2', recordId: 'r1' });
    });
    expect(onAttested).not.toHaveBeenCalled();
  });
});
