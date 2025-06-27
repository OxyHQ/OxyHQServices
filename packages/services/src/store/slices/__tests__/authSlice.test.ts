import { configureStore, EnhancedStore } from '@reduxjs/toolkit';
import authReducer, {
  initAuth,
  login,
  logout,
  logoutAll,
  signUp,
  switchSession,
  AuthState,
  Storage,
  setOxyServices,
  clearError, // Import clearError action
} from '../authSlice'; // Corrected path to authSlice
import { OxyServices, User, SecureLoginResponse, MinimalUserData, SecureClientSession } from '../../..'; // Adjust path as needed
import { DeviceManager } from '../../../utils/deviceManager'; // Corrected path

// Mock OxyServices
jest.mock('../../../core'); // This will mock the OxyServices class
const MockOxyServices = OxyServices as jest.MockedClass<typeof OxyServices>;

// Mock DeviceManager
jest.mock('../../../utils/deviceManager'); // Corrected path
const MockDeviceManager = DeviceManager as jest.Mocked<typeof DeviceManager>;

// Mock Storage
const mockStorage: Storage = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
};

const testUser: User = {
  id: 'user123',
  _id: 'user123',
  username: 'testuser',
  email: 'test@example.com',
  name: { first: 'Test', last: 'User' },
  avatar: 'avatar.png',
  createdAt: new Date(),
  updatedAt: new Date(),
  // Dummy values for other required fields from User interface
  bookmarks: [],
  refreshToken: null,
  privacySettings: {
    isPrivateAccount: false,
    hideOnlineStatus: false,
    hideLastSeen: false,
    profileVisibility: false,
    postVisibility: false,
    twoFactorEnabled: false,
    loginAlerts: false,
    blockScreenshots: false,
    secureLogin: false,
    biometricLogin: false,
    showActivity: false,
    allowTagging: false,
    allowMentions: false,
    hideReadReceipts: false,
    allowComments: false,
    allowDirectMessages: false,
    dataSharing: false,
    locationSharing: false,
    analyticsSharing: false,
    sensitiveContent: false,
    autoFilter: false,
    muteKeywords: false,
  },
  associated: { lists: 0, feedgens: 0, starterPacks: 0, labeler: false },
  labels: [],
  description: '',
  coverPhoto: '',
  location: '',
  website: '',
  pinnedPost: { cid: '', uri: '' },
  _count: { followers: 0, following: 0, posts: 0, karma:0 },
};

const minimalTestUser: MinimalUserData = {
  id: 'user123',
  username: 'testuser',
  avatar: 'avatar.png',
};

const testSession: SecureClientSession = {
  sessionId: 'session123',
  deviceId: 'device123',
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  lastActive: new Date().toISOString(),
  userId: 'user123',
  username: 'testuser',
};

const testLoginResponse: SecureLoginResponse = {
  sessionId: 'session123',
  deviceId: 'device123',
  user: minimalTestUser,
  expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
  createdAt: new Date().toISOString(),
};

describe('authSlice', () => {
  let store: EnhancedStore<{ auth: AuthState }>;
  let mockOxyServicesInstance: jest.Mocked<OxyServices>;

  beforeEach(() => {
    mockOxyServicesInstance = new MockOxyServices({ baseURL: 'test' }) as jest.Mocked<OxyServices>;

    store = configureStore({
      reducer: {
        auth: authReducer,
      },
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
          serializableCheck: {
            ignoredActions: ['auth/initAuth/fulfilled', 'auth/setOxyServices', 'auth/login/fulfilled', 'auth/signUp/fulfilled', 'auth/switchSession/fulfilled'],
            ignoredPaths: ['auth.oxyServices'],
          },
        }),
    });

    store.dispatch(setOxyServices(mockOxyServicesInstance));

    (mockStorage.getItem as jest.Mock).mockReset();
    (mockStorage.setItem as jest.Mock).mockReset();
    (mockStorage.removeItem as jest.Mock).mockReset();
    (MockDeviceManager.getDeviceFingerprint as jest.Mock).mockReset();
    (MockDeviceManager.getDeviceInfo as jest.Mock).mockResolvedValue({ deviceId: 'mockDevice', deviceName: 'Mock Device' });
  });

  describe('initAuth thunk', () => {
    it('should initialize with no stored session', async () => {
      (mockStorage.getItem as jest.Mock).mockResolvedValue(null);
      await store.dispatch(initAuth({ oxyServices: mockOxyServicesInstance, storage: mockStorage }));
      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.sessions).toEqual([]);
      expect(state.isLoading).toBe(false);
    });

    it('should initialize with a valid stored session', async () => {
      (mockStorage.getItem as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify([testSession]))
        .mockResolvedValueOnce(testSession.sessionId);

      mockOxyServicesInstance.validateSession.mockResolvedValue({ valid: true, expiresAt: '', lastActivity: '', user: testUser });
      mockOxyServicesInstance.getTokenBySession.mockResolvedValue({ accessToken: 'token', expiresAt: '' });
      mockOxyServicesInstance.getUserBySession.mockResolvedValue(testUser);

      await store.dispatch(initAuth({ oxyServices: mockOxyServicesInstance, storage: mockStorage }));
      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(testUser);
      expect(state.minimalUser).toEqual(minimalTestUser);
      expect(state.activeSessionId).toBe(testSession.sessionId);
      expect(state.sessions).toEqual([testSession]);
    });

    it('should handle invalid stored session during init', async () => {
      (mockStorage.getItem as jest.Mock)
        .mockResolvedValueOnce(JSON.stringify([testSession]))
        .mockResolvedValueOnce(testSession.sessionId);

      mockOxyServicesInstance.validateSession.mockResolvedValue({ valid: false, expiresAt: '', lastActivity: '', user: testUser });

      await store.dispatch(initAuth({ oxyServices: mockOxyServicesInstance, storage: mockStorage }));
      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.activeSessionId).toBeNull();
      expect(state.sessions).toEqual([]);
      expect(mockStorage.setItem).toHaveBeenCalledWith(expect.stringContaining('sessions'), JSON.stringify([]));
    });
  });

  describe('login thunk', () => {
    it('should login successfully and update state', async () => {
      MockDeviceManager.getDeviceFingerprint.mockReturnValue('fingerprint123');
      mockOxyServicesInstance.secureLogin.mockResolvedValue(testLoginResponse);
      mockOxyServicesInstance.getTokenBySession.mockResolvedValue({ accessToken: 'token', expiresAt: '' });
      mockOxyServicesInstance.getUserBySession.mockResolvedValue(testUser);

      await store.dispatch(login({
        username: 'testuser',
        password: 'password',
        oxyServices: mockOxyServicesInstance,
        storage: mockStorage,
        currentSessions: [],
        currentActiveSessionId: null,
      }));

      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(testUser);
      expect(state.minimalUser).toEqual(minimalTestUser);
      expect(state.activeSessionId).toBe(testLoginResponse.sessionId);
      expect(state.sessions.length).toBe(1);
      expect(state.sessions[0].sessionId).toBe(testLoginResponse.sessionId);
      expect(mockStorage.setItem).toHaveBeenCalledTimes(2);
    });

    it('should handle login failure', async () => {
      mockOxyServicesInstance.secureLogin.mockRejectedValue(new Error('Invalid credentials'));

      const action = await store.dispatch(login({
        username: 'testuser',
        password: 'wrongpassword',
        oxyServices: mockOxyServicesInstance,
        storage: mockStorage,
        currentSessions: [],
        currentActiveSessionId: null,
      }));

      expect(login.rejected.match(action)).toBe(true);
      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(false);
      expect(state.error).toBe('Invalid credentials');
    });
  });

  describe('logout thunk', () => {
    beforeEach(() => {
      store.dispatch({
        type: 'auth/login/fulfilled',
        payload: {
          user: testUser,
          minimalUser: minimalTestUser,
          sessions: [testSession],
          activeSessionId: testSession.sessionId,
        },
      });
    });

    it('should logout successfully and clear user state', async () => {
      mockOxyServicesInstance.logoutSecureSession.mockResolvedValue(undefined);

      await store.dispatch(logout({
        oxyServices: mockOxyServicesInstance,
        storage: mockStorage,
        currentSessions: [testSession],
        currentActiveSessionId: testSession.sessionId,
      }));

      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.activeSessionId).toBeNull();
      expect(state.sessions).toEqual([]);
      expect(mockStorage.setItem).toHaveBeenCalledWith(expect.stringContaining('sessions'), JSON.stringify([]));
      expect(mockStorage.removeItem).toHaveBeenCalledWith(expect.stringContaining('active_session_id'));
    });

    it('should switch to another session if logging out a non-active primary session and others exist', async () => {
        const anotherSession: SecureClientSession = { ...testSession, sessionId: 'session456', userId: 'user123', username: 'testuser' };
        const initialSessions = [testSession, anotherSession];
        // Simulate initial state with testSession active
        const initialState: AuthState = {
            user: testUser,
            minimalUser: minimalTestUser,
            sessions: initialSessions,
            activeSessionId: testSession.sessionId,
            isAuthenticated: true,
            isLoading: false,
            error: null,
            oxyServices: mockOxyServicesInstance,
        };
        store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: initialState }, middleware: (getDefaultMiddleware) => getDefaultMiddleware({serializableCheck: false})});
        store.dispatch(setOxyServices(mockOxyServicesInstance)); // Re-set service instance for new store

        mockOxyServicesInstance.logoutSecureSession.mockResolvedValue(undefined);
        mockOxyServicesInstance.getTokenBySession.mockResolvedValue({ accessToken: 'new_token', expiresAt: '' });
        mockOxyServicesInstance.getUserBySession.mockResolvedValue(testUser);

        await store.dispatch(logout({
            targetSessionId: testSession.sessionId,
            oxyServices: mockOxyServicesInstance,
            storage: mockStorage,
            currentSessions: initialSessions,
            currentActiveSessionId: testSession.sessionId,
        }));

        const state = store.getState().auth;
        expect(state.isAuthenticated).toBe(true);
        expect(state.user).toEqual(testUser);
        expect(state.activeSessionId).toBe(anotherSession.sessionId);
        expect(state.sessions).toEqual([anotherSession]);
        expect(mockStorage.setItem).toHaveBeenCalledWith(expect.stringContaining('sessions'), JSON.stringify([anotherSession]));
        expect(mockStorage.setItem).toHaveBeenCalledWith(expect.stringContaining('active_session_id'), anotherSession.sessionId);
    });
  });

  describe('logoutAll thunk', () => {
     beforeEach(() => {
      store.dispatch({
        type: 'auth/login/fulfilled',
        payload: {
          user: testUser,
          minimalUser: minimalTestUser,
          sessions: [testSession],
          activeSessionId: testSession.sessionId,
        },
      });
    });
    it('should logout from all sessions and clear state', async () => {
      mockOxyServicesInstance.logoutAllSecureSessions.mockResolvedValue(undefined);
      await store.dispatch(logoutAll({
        oxyServices: mockOxyServicesInstance,
        storage: mockStorage,
        currentActiveSessionId: testSession.sessionId,
      }));

      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(false);
      expect(state.user).toBeNull();
      expect(state.activeSessionId).toBeNull();
      expect(state.sessions).toEqual([]);
      expect(mockStorage.removeItem).toHaveBeenCalledWith(expect.stringContaining('sessions'));
      expect(mockStorage.removeItem).toHaveBeenCalledWith(expect.stringContaining('active_session_id'));
    });
  });

  describe('signUp thunk', () => {
    it('should signUp and then login successfully', async () => {
      mockOxyServicesInstance.signUp.mockResolvedValue({ message: 'Signup success', token: 'someToken', user: testUser });
      MockDeviceManager.getDeviceFingerprint.mockReturnValue('fingerprint123');
      mockOxyServicesInstance.secureLogin.mockResolvedValue(testLoginResponse);
      mockOxyServicesInstance.getTokenBySession.mockResolvedValue({ accessToken: 'token', expiresAt: '' });
      mockOxyServicesInstance.getUserBySession.mockResolvedValue(testUser);

      await store.dispatch(signUp({
        username: 'newuser',
        email: 'new@example.com',
        password: 'newpassword',
        oxyServices: mockOxyServicesInstance,
        storage: mockStorage,
        currentSessions: [],
        currentActiveSessionId: null,
      }));

      const state = store.getState().auth;
      expect(state.isAuthenticated).toBe(true);
      expect(state.user).toEqual(testUser);
      expect(state.activeSessionId).toBe(testLoginResponse.sessionId);
    });
  });

  describe('switchSession thunk', () => {
    const session1: SecureClientSession = { ...testSession, sessionId: 's1' };
    const session2: SecureClientSession = { ...testSession, sessionId: 's2', userId: 'user123', username: 'testuser' };
    const userForS2: User = { ...testUser, id:'user123', username: 'UserForS2' };
     let initialSwitchState: AuthState;


    beforeEach(() => {
      initialSwitchState = {
        user: testUser,
        minimalUser: minimalTestUser,
        sessions: [session1, session2],
        activeSessionId: session1.sessionId,
        isAuthenticated: true,
        isLoading: false,
        error: null,
        oxyServices: mockOxyServicesInstance,
      };
      store = configureStore({ reducer: { auth: authReducer }, preloadedState: { auth: initialSwitchState }, middleware: (getDefaultMiddleware) => getDefaultMiddleware({serializableCheck: false}) });
      store.dispatch(setOxyServices(mockOxyServicesInstance)); // Re-set service instance
    });

    it('should switch to another session successfully', async () => {
      mockOxyServicesInstance.getTokenBySession.mockResolvedValue({ accessToken: 'token-s2', expiresAt: '' });
      mockOxyServicesInstance.getUserBySession.mockResolvedValue(userForS2);

      await store.dispatch(switchSession({
        sessionId: session2.sessionId,
        oxyServices: mockOxyServicesInstance,
        storage: mockStorage,
      }));

      const state = store.getState().auth;
      expect(state.activeSessionId).toBe(session2.sessionId);
      expect(state.user).toEqual(userForS2);
      expect(state.minimalUser).toEqual({id: userForS2.id, username: userForS2.username, avatar: userForS2.avatar});
      expect(mockStorage.setItem).toHaveBeenCalledWith(expect.stringContaining('active_session_id'), session2.sessionId);
    });
  });

  describe('direct reducers', () => {
    it('setOxyServices should update oxyServices instance in state', () => {
        const newMockService = new MockOxyServices({ baseURL: 'new-url' }) as jest.Mocked<OxyServices>;
        store.dispatch(setOxyServices(newMockService));
        expect(store.getState().auth.oxyServices).toBe(newMockService);
    });

    it('clearError should nullify the error field', () => {
        const initialStateWithError: AuthState = {
            ...store.getState().auth, // spread current state
            error: "Test error"
        };
        // Configure store with this initial state for the test
        const testStore = configureStore({
            reducer: { auth: authReducer },
            preloadedState: { auth: initialStateWithError },
            middleware: (getDefaultMiddleware) => getDefaultMiddleware({serializableCheck: false})
        });

        expect(testStore.getState().auth.error).toBe('Test error');
        testStore.dispatch(clearError()); // Dispatch the imported clearError action
        expect(testStore.getState().auth.error).toBeNull();
    });
  });
});
