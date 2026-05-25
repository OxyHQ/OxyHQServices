/**
 * Tests for `useOnlineStatus`.
 *
 * The boolean from this hook is consumed by app shells to render
 * "You're offline" banners. Bugs are subtle: a stuck `true` would
 * hide the banner forever during a real outage; a stuck `false`
 * would scare users into thinking they're offline when they aren't.
 */

import { act, renderHook } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { useOnlineStatus } from '../../src/ui/hooks/useOnlineStatus';

describe('useOnlineStatus', () => {
  let originalIsOnline: boolean;

  beforeEach(() => {
    originalIsOnline = onlineManager.isOnline();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(originalIsOnline);
  });

  it('reflects the current onlineManager state on initial render', () => {
    onlineManager.setOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it('starts false when the onlineManager reports offline', () => {
    onlineManager.setOnline(false);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
  });

  it('rerenders when onlineManager transitions from online to offline and back', () => {
    onlineManager.setOnline(true);
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);

    act(() => {
      onlineManager.setOnline(false);
    });
    expect(result.current).toBe(false);

    act(() => {
      onlineManager.setOnline(true);
    });
    expect(result.current).toBe(true);
  });
});
