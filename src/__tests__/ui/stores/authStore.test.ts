import { renderHook, act } from '@testing-library/react-native';
import { useAuthStore } from '../../../ui/stores/authStore';

describe('AuthStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useAuthStore.getState().clearAuth();
  });

  it('should initialize with correct default values', () => {
    const { result } = renderHook(() => useAuthStore());

    expect(result.current.user).toBe(null);
    expect(result.current.minimalUser).toBe(null);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.activeSessionId).toBe(null);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('should update user correctly', () => {
    const { result } = renderHook(() => useAuthStore());

    const mockUser = {
      id: '123',
      username: 'testuser',
      email: 'test@example.com'
    };

    act(() => {
      result.current.setUser(mockUser as any);
    });

    expect(result.current.user).toEqual(mockUser);
  });

  it('should update authentication state correctly', () => {
    const { result } = renderHook(() => useAuthStore());

    act(() => {
      result.current.setAuthenticated(true);
    });

    expect(result.current.isAuthenticated).toBe(true);
  });

  it('should add sessions correctly', () => {
    const { result } = renderHook(() => useAuthStore());

    const mockSession = {
      sessionId: 'session123',
      deviceId: 'device123',
      expiresAt: '2024-12-31T23:59:59.000Z',
      lastActive: '2024-01-01T00:00:00.000Z',
      userId: 'user123',
      username: 'testuser'
    };

    act(() => {
      result.current.addSession(mockSession);
    });

    expect(result.current.sessions).toHaveLength(1);
    expect(result.current.sessions[0]).toEqual(mockSession);
  });

  it('should remove sessions correctly', () => {
    const { result } = renderHook(() => useAuthStore());

    const mockSession = {
      sessionId: 'session123',
      deviceId: 'device123',
      expiresAt: '2024-12-31T23:59:59.000Z',
      lastActive: '2024-01-01T00:00:00.000Z',
      userId: 'user123',
      username: 'testuser'
    };

    act(() => {
      result.current.addSession(mockSession);
      result.current.removeSessionById('session123');
    });

    expect(result.current.sessions).toHaveLength(0);
  });

  it('should get session by ID correctly', () => {
    const { result } = renderHook(() => useAuthStore());

    const mockSession = {
      sessionId: 'session123',
      deviceId: 'device123',
      expiresAt: '2024-12-31T23:59:59.000Z',
      lastActive: '2024-01-01T00:00:00.000Z',
      userId: 'user123',
      username: 'testuser'
    };

    act(() => {
      result.current.addSession(mockSession);
    });

    const foundSession = result.current.getSessionById('session123');
    expect(foundSession).toEqual(mockSession);

    const notFound = result.current.getSessionById('nonexistent');
    expect(notFound).toBeUndefined();
  });

  it('should update existing sessions', () => {
    const { result } = renderHook(() => useAuthStore());

    const mockSession = {
      sessionId: 'session123',
      deviceId: 'device123',
      expiresAt: '2024-12-31T23:59:59.000Z',
      lastActive: '2024-01-01T00:00:00.000Z',
      userId: 'user123',
      username: 'testuser'
    };

    act(() => {
      result.current.addSession(mockSession);
      result.current.updateSession('session123', { lastActive: '2024-06-15T12:00:00.000Z' });
    });

    const updatedSession = result.current.getSessionById('session123');
    expect(updatedSession?.lastActive).toBe('2024-06-15T12:00:00.000Z');
  });

  it('should clear authentication state', () => {
    const { result } = renderHook(() => useAuthStore());

    const mockUser = { id: '123', username: 'testuser' };
    const mockSession = {
      sessionId: 'session123',
      deviceId: 'device123',
      expiresAt: '2024-12-31T23:59:59.000Z',
      lastActive: '2024-01-01T00:00:00.000Z',
      userId: 'user123',
      username: 'testuser'
    };

    act(() => {
      result.current.setUser(mockUser as any);
      result.current.addSession(mockSession);
      result.current.setActiveSessionId('session123');
      result.current.setAuthenticated(true);
      result.current.clearAuth();
    });

    expect(result.current.user).toBe(null);
    expect(result.current.sessions).toEqual([]);
    expect(result.current.activeSessionId).toBe(null);
    expect(result.current.isAuthenticated).toBe(false);
  });
});