/**
 * Basic test for Zustand store functionality
 * This test verifies that the store can be imported and basic operations work
 */

import { useOxyStore } from '../../../ui/stores/oxyStore';

// Mock OxyServices for testing
const mockOxyServices = {
  secureLogin: jest.fn(),
  getUserBySession: jest.fn(),
  validateSession: jest.fn(),
  getTokenBySession: jest.fn(),
  logoutSecureSession: jest.fn(),
  logoutAllSecureSessions: jest.fn(),
  getSessionsBySessionId: jest.fn(),
  getDeviceSessions: jest.fn(),
  logoutAllDeviceSessions: jest.fn(),
  updateDeviceName: jest.fn(),
};

// Mock AsyncStorage for React Native
const mockAsyncStorage = {
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
};

// Mock localStorage for web
const mockLocalStorage = {
  getItem: jest.fn(() => null),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

// Set up global mocks
global.localStorage = mockLocalStorage as any;

// Mock navigator to simulate React Native environment
const originalNavigator = global.navigator;

describe('OxyStore', () => {
  beforeEach(() => {
    // Reset store state
    useOxyStore.setState({
      user: null,
      minimalUser: null,
      sessions: [],
      activeSessionId: null,
      isAuthenticated: false,
      isLoading: true,
      error: null,
      oxyServices: null,
      bottomSheetRef: undefined,
      storage: null,
      storageKeyPrefix: 'oxy_secure',
      onAuthStateChange: undefined,
    });

    // Clear all mocks
    jest.clearAllMocks();
  });

  afterAll(() => {
    // Restore original navigator
    global.navigator = originalNavigator;
  });

  it('should initialize with default state', () => {
    const state = useOxyStore.getState();
    
    expect(state.user).toBeNull();
    expect(state.minimalUser).toBeNull();
    expect(state.sessions).toEqual([]);
    expect(state.activeSessionId).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.isLoading).toBe(true);
    expect(state.error).toBeNull();
    expect(state.storageKeyPrefix).toBe('oxy_secure');
  });

  it('should update user state correctly', () => {
    const mockUser = {
      id: '123',
      username: 'testuser',
      email: 'test@example.com',
      avatar: 'avatar.png'
    };

    const { setUser } = useOxyStore.getState();
    setUser(mockUser);

    const state = useOxyStore.getState();
    expect(state.user).toEqual(mockUser);
    expect(state.isAuthenticated).toBe(true);
  });

  it('should update sessions correctly', () => {
    const mockSessions = [
      {
        sessionId: 'session1',
        deviceId: 'device1',
        expiresAt: '2024-12-31T23:59:59Z',
        lastActive: '2024-01-01T00:00:00Z',
        userId: 'user1',
        username: 'testuser'
      }
    ];

    const { setSessions } = useOxyStore.getState();
    setSessions(mockSessions);

    const state = useOxyStore.getState();
    expect(state.sessions).toEqual(mockSessions);
  });

  it('should set loading state correctly', () => {
    const { setIsLoading } = useOxyStore.getState();
    
    setIsLoading(false);
    expect(useOxyStore.getState().isLoading).toBe(false);
    
    setIsLoading(true);
    expect(useOxyStore.getState().isLoading).toBe(true);
  });

  it('should set error state correctly', () => {
    const { setError } = useOxyStore.getState();
    
    setError('Test error');
    expect(useOxyStore.getState().error).toBe('Test error');
    
    setError(null);
    expect(useOxyStore.getState().error).toBeNull();
  });

  it('should set OxyServices correctly', () => {
    const { setOxyServices } = useOxyStore.getState();
    setOxyServices(mockOxyServices as any);

    const state = useOxyStore.getState();
    expect(state.oxyServices).toBe(mockOxyServices);
  });

  it('should handle storage prefix configuration', () => {
    const { setStorageKeyPrefix } = useOxyStore.getState();
    setStorageKeyPrefix('custom_prefix');

    const state = useOxyStore.getState();
    expect(state.storageKeyPrefix).toBe('custom_prefix');
  });

  it('should call onAuthStateChange when user is set', () => {
    const mockCallback = jest.fn();
    const mockUser = {
      id: '123',
      username: 'testuser',
      email: 'test@example.com',
      avatar: 'avatar.png'
    };

    const { setOnAuthStateChange, setUser } = useOxyStore.getState();
    setOnAuthStateChange(mockCallback);
    setUser(mockUser);

    expect(mockCallback).toHaveBeenCalledWith(mockUser);
  });

  it('should handle web storage detection', () => {
    // Simulate web environment
    global.navigator = { product: 'Gecko' } as any;
    
    const { setStorage } = useOxyStore.getState();
    setStorage(mockLocalStorage);

    const state = useOxyStore.getState();
    expect(state.storage).toBe(mockLocalStorage);
  });

  it('should provide all required methods', () => {
    const state = useOxyStore.getState();
    
    // Check that all required methods exist
    expect(typeof state.login).toBe('function');
    expect(typeof state.logout).toBe('function');
    expect(typeof state.logoutAll).toBe('function');
    expect(typeof state.signUp).toBe('function');
    expect(typeof state.switchSession).toBe('function');
    expect(typeof state.removeSession).toBe('function');
    expect(typeof state.refreshSessions).toBe('function');
    expect(typeof state.getDeviceSessions).toBe('function');
    expect(typeof state.logoutAllDeviceSessions).toBe('function');
    expect(typeof state.updateDeviceName).toBe('function');
    expect(typeof state.showBottomSheet).toBe('function');
    expect(typeof state.hideBottomSheet).toBe('function');
    
    // Check internal methods
    expect(typeof state.initializeAuth).toBe('function');
    expect(typeof state.saveSessionsToStorage).toBe('function');
    expect(typeof state.saveActiveSessionId).toBe('function');
    expect(typeof state.clearAllStorage).toBe('function');
    expect(typeof state.switchToSession).toBe('function');
    expect(typeof state.removeInvalidSession).toBe('function');
  });
});