import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit';
import { OxyServices, User, SecureLoginResponse, SecureClientSession, MinimalUserData } from '../../'; // Assuming interfaces are exported from root
import { DeviceManager } from '../../utils/deviceManager';

// Define the shape of the authentication state
export interface AuthState {
  user: User | null;
  minimalUser: MinimalUserData | null;
  sessions: SecureClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  oxyServices: OxyServices | null; // To be initialized
}

const initialState: AuthState = {
  user: null,
  minimalUser: null,
  sessions: [],
  activeSessionId: null,
  isAuthenticated: false,
  isLoading: false,
  error: null,
  oxyServices: null,
};

// Async thunks for authentication operations
// These will dispatch pending/fulfilled/rejected actions automatically

export const initAuth = createAsyncThunk<
  { user: User | null; minimalUser: MinimalUserData | null, sessions: SecureClientSession[]; activeSessionId: string | null; oxyServices: OxyServices }, // Return type of the payload creator
  { oxyServices: OxyServices; storage: Storage; storageKeyPrefix?: string }, // First argument to the payload creator
  { rejectValue: string } // Types for ThunkAPI
>(
  'auth/initAuth',
  async ({ oxyServices, storage, storageKeyPrefix = 'oxy_secure' }, { rejectWithValue }) => {
    try {
      const keys = {
        sessions: `${storageKeyPrefix}_sessions`,
        activeSessionId: `${storageKeyPrefix}_active_session_id`,
      };
      const sessionsData = await storage.getItem(keys.sessions);
      const storedActiveSessionId = await storage.getItem(keys.activeSessionId);

      let loadedSessions: SecureClientSession[] = [];
      let finalUser: User | null = null;
      let finalMinimalUser: MinimalUserData | null = null;
      let finalActiveSessionId: string | null = null;

      if (sessionsData) {
        const parsedSessions: SecureClientSession[] = JSON.parse(sessionsData);
        const migratedSessions: SecureClientSession[] = [];
        let shouldUpdateStorage = false;

        for (const session of parsedSessions) {
          if (!session.userId || !session.username) {
            try {
              const sessionUser = await oxyServices.getUserBySession(session.sessionId);
              migratedSessions.push({
                ...session,
                userId: sessionUser.id,
                username: sessionUser.username,
              });
              shouldUpdateStorage = true;
            } catch (e) {
              shouldUpdateStorage = true; // Remove invalid session
            }
          } else {
            migratedSessions.push(session);
          }
        }
        if (shouldUpdateStorage) {
          await storage.setItem(keys.sessions, JSON.stringify(migratedSessions));
        }
        loadedSessions = migratedSessions;
      }

      if (storedActiveSessionId && loadedSessions.length > 0) {
        const activeSession = loadedSessions.find(s => s.sessionId === storedActiveSessionId);
        if (activeSession) {
          try {
            const validation = await oxyServices.validateSession(activeSession.sessionId);
            if (validation.valid) {
              await oxyServices.getTokenBySession(activeSession.sessionId);
              finalUser = await oxyServices.getUserBySession(activeSession.sessionId);
              finalMinimalUser = { id: finalUser.id, username: finalUser.username, avatar: finalUser.avatar };
              finalActiveSessionId = activeSession.sessionId;
            } else {
              // remove invalid session
              loadedSessions = loadedSessions.filter(s => s.sessionId !== activeSession.sessionId);
              await storage.setItem(keys.sessions, JSON.stringify(loadedSessions));
               if (loadedSessions.length > 0) {
                 // try to switch to another session if available
                 const nextSession = loadedSessions[0];
                 await oxyServices.getTokenBySession(nextSession.sessionId);
                 finalUser = await oxyServices.getUserBySession(nextSession.sessionId);
                 finalMinimalUser = { id: finalUser.id, username: finalUser.username, avatar: finalUser.avatar };
                 finalActiveSessionId = nextSession.sessionId;
                 await storage.setItem(keys.activeSessionId, finalActiveSessionId);
               } else {
                  await storage.removeItem(keys.activeSessionId);
               }
            }
          } catch (e: any) {
            loadedSessions = loadedSessions.filter(s => s.sessionId !== activeSession.sessionId);
            await storage.setItem(keys.sessions, JSON.stringify(loadedSessions));
            if (loadedSessions.length > 0) {
                 // try to switch to another session if available
                 const nextSession = loadedSessions[0];
                 await oxyServices.getTokenBySession(nextSession.sessionId);
                 finalUser = await oxyServices.getUserBySession(nextSession.sessionId);
                 finalMinimalUser = { id: finalUser.id, username: finalUser.username, avatar: finalUser.avatar };
                 finalActiveSessionId = nextSession.sessionId;
                 await storage.setItem(keys.activeSessionId, finalActiveSessionId);
            } else {
                await storage.removeItem(keys.activeSessionId);
            }
          }
        } else {
            await storage.removeItem(keys.activeSessionId); // active session id not in list
        }
      }
       return { user: finalUser, minimalUser: finalMinimalUser, sessions: loadedSessions, activeSessionId: finalActiveSessionId, oxyServices };
    } catch (err: any) {
      await storage.removeItem(`${storageKeyPrefix}_sessions`);
      await storage.removeItem(`${storageKeyPrefix}_active_session_id`);
      return rejectWithValue(err.message || 'Failed to initialize auth');
    }
  }
);

export const login = createAsyncThunk<
  { user: User; minimalUser: MinimalUserData; sessions: SecureClientSession[]; activeSessionId: string, storage: Storage, storageKeyPrefix?: string },
  { username: string; password: string; deviceName?: string, oxyServices: OxyServices, storage: Storage, storageKeyPrefix?: string, currentSessions: SecureClientSession[], currentActiveSessionId: string | null },
  { rejectValue: string }
>(
  'auth/login',
  async ({ username, password, deviceName, oxyServices, storage, storageKeyPrefix = 'oxy_secure', currentSessions, currentActiveSessionId }, { rejectWithValue }) => {
    try {
      const deviceFingerprint = DeviceManager.getDeviceFingerprint();
      const deviceInfo = await DeviceManager.getDeviceInfo();
      const loginResponse: SecureLoginResponse = await oxyServices.secureLogin(
        username,
        password,
        deviceName || deviceInfo.deviceName || DeviceManager.getDefaultDeviceName(),
        deviceFingerprint
      );

      const clientSession: SecureClientSession = {
        sessionId: loginResponse.sessionId,
        deviceId: loginResponse.deviceId,
        expiresAt: loginResponse.expiresAt,
        lastActive: new Date().toISOString(),
        userId: loginResponse.user.id,
        username: loginResponse.user.username,
      };

      let updatedSessions: SecureClientSession[];
      const existingUserSessionIndex = currentSessions.findIndex(s => s.userId === loginResponse.user.id || s.username === loginResponse.user.username);

      if (existingUserSessionIndex !== -1) {
        updatedSessions = [...currentSessions];
        updatedSessions[existingUserSessionIndex] = clientSession;
      } else {
        updatedSessions = [...currentSessions, clientSession];
      }

      const keys = {
        sessions: `${storageKeyPrefix}_sessions`,
        activeSessionId: `${storageKeyPrefix}_active_session_id`,
      };

      await storage.setItem(keys.sessions, JSON.stringify(updatedSessions));
      await storage.setItem(keys.activeSessionId, loginResponse.sessionId);

      await oxyServices.getTokenBySession(loginResponse.sessionId);
      const fullUser = await oxyServices.getUserBySession(loginResponse.sessionId);

      return { user: fullUser, minimalUser: loginResponse.user, sessions: updatedSessions, activeSessionId: loginResponse.sessionId, storage, storageKeyPrefix };
    } catch (err: any) {
      return rejectWithValue(err.message || 'Login failed');
    }
  }
);

export const logout = createAsyncThunk<
  { newActiveUser: User | null, newMinimalUser: MinimalUserData | null, newSessions: SecureClientSession[], newActiveSessionId: string | null, storage: Storage, storageKeyPrefix?: string },
  { targetSessionId?: string, oxyServices: OxyServices, storage: Storage, storageKeyPrefix?: string, currentSessions: SecureClientSession[], currentActiveSessionId: string | null },
  { rejectValue: string }
>(
  'auth/logout',
  async ({ targetSessionId, oxyServices, storage, storageKeyPrefix = 'oxy_secure', currentSessions, currentActiveSessionId }, { rejectWithValue }) => {
    if (!currentActiveSessionId) return rejectWithValue('No active session');
    try {
      const sessionToLogout = targetSessionId || currentActiveSessionId;
      await oxyServices.logoutSecureSession(currentActiveSessionId, sessionToLogout);

      const keys = {
        sessions: `${storageKeyPrefix}_sessions`,
        activeSessionId: `${storageKeyPrefix}_active_session_id`,
      };

      let newSessions = currentSessions.filter(s => s.sessionId !== sessionToLogout);
      await storage.setItem(keys.sessions, JSON.stringify(newSessions));

      let newActiveUser: User | null = null;
      let newMinimalUser: MinimalUserData | null = null;
      let newActiveSessionId: string | null = null;

      if (sessionToLogout === currentActiveSessionId) {
        if (newSessions.length > 0) {
          newActiveSessionId = newSessions[0].sessionId;
          await storage.setItem(keys.activeSessionId, newActiveSessionId);
          await oxyServices.getTokenBySession(newActiveSessionId);
          newActiveUser = await oxyServices.getUserBySession(newActiveSessionId);
          newMinimalUser = {id: newActiveUser.id, username: newActiveUser.username, avatar: newActiveUser.avatar };
        } else {
          await storage.removeItem(keys.activeSessionId);
        }
      } else {
        // If we logged out a different session, the active one remains
        newActiveSessionId = currentActiveSessionId;
        const activeSessionStillExists = newSessions.find(s => s.sessionId === newActiveSessionId);
        if (activeSessionStillExists) {
             await oxyServices.getTokenBySession(newActiveSessionId); // Ensure token is set for current active
             newActiveUser = await oxyServices.getUserBySession(newActiveSessionId);
             newMinimalUser = {id: newActiveUser.id, username: newActiveUser.username, avatar: newActiveUser.avatar };
        } else {
            // This case should ideally not happen if logic is correct elsewhere
            // but as a fallback, clear active session if it was removed somehow
            newActiveSessionId = null;
            await storage.removeItem(keys.activeSessionId);
        }
      }
      return { newActiveUser, newMinimalUser, newSessions, newActiveSessionId, storage, storageKeyPrefix };
    } catch (err: any) {
      return rejectWithValue(err.message || 'Logout failed');
    }
  }
);


export const logoutAll = createAsyncThunk<
  { storage: Storage, storageKeyPrefix?: string }, // Return type
  { oxyServices: OxyServices, storage: Storage, storageKeyPrefix?: string, currentActiveSessionId: string | null }, // Argument type
  { rejectValue: string } // ThunkAPI config
>(
  'auth/logoutAll',
  async ({ oxyServices, storage, storageKeyPrefix = 'oxy_secure', currentActiveSessionId }, { rejectWithValue }) => {
    if (!currentActiveSessionId) return rejectWithValue('No active session');
    try {
      await oxyServices.logoutAllSecureSessions(currentActiveSessionId);
      const keys = {
        sessions: `${storageKeyPrefix}_sessions`,
        activeSessionId: `${storageKeyPrefix}_active_session_id`,
      };
      await storage.removeItem(keys.sessions);
      await storage.removeItem(keys.activeSessionId);
      return { storage, storageKeyPrefix };
    } catch (err: any) {
      return rejectWithValue(err.message || 'Logout all failed');
    }
  }
);

export const signUp = createAsyncThunk<
  { user: User; minimalUser: MinimalUserData; sessions: SecureClientSession[]; activeSessionId: string, storage: Storage, storageKeyPrefix?: string },
  { username: string; email: string; password: string; oxyServices: OxyServices, storage: Storage, storageKeyPrefix?: string, currentSessions: SecureClientSession[], currentActiveSessionId: string | null },
  { rejectValue: string }
>(
  'auth/signUp',
  async ({ username, email, password, oxyServices, storage, storageKeyPrefix, currentSessions, currentActiveSessionId }, { dispatch, rejectWithValue }) => {
    try {
      await oxyServices.signUp(username, email, password);
      // After successful signup, log the user in to create a session
      // We need to dispatch the login thunk here
      const loginResult = await dispatch(login({ username, password, oxyServices, storage, storageKeyPrefix, currentSessions, currentActiveSessionId }));
      if (login.fulfilled.match(loginResult)) {
        return loginResult.payload;
      } else {
        throw new Error(loginResult.payload as string || 'Sign up succeeded but login failed');
      }
    } catch (err: any) {
      return rejectWithValue(err.message || 'Sign up failed');
    }
  }
);

export const switchSession = createAsyncThunk<
  { user: User; minimalUser: MinimalUserData; activeSessionId: string, storage: Storage, storageKeyPrefix?: string },
  { sessionId: string; oxyServices: OxyServices, storage: Storage, storageKeyPrefix?: string },
  { rejectValue: string }
>(
  'auth/switchSession',
  async ({ sessionId, oxyServices, storage, storageKeyPrefix = 'oxy_secure' }, { rejectWithValue }) => {
    try {
      await oxyServices.getTokenBySession(sessionId);
      const fullUser = await oxyServices.getUserBySession(sessionId);
      const minimalUser = { id: fullUser.id, username: fullUser.username, avatar: fullUser.avatar };
      const keys = { activeSessionId: `${storageKeyPrefix}_active_session_id` };
      await storage.setItem(keys.activeSessionId, sessionId);
      return { user: fullUser, minimalUser, activeSessionId: sessionId, storage, storageKeyPrefix };
    } catch (err: any) {
      return rejectWithValue(err.message || 'Failed to switch session');
    }
  }
);


// Auth slice
const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setOxyServices: (state, action: PayloadAction<OxyServices>) => {
      state.oxyServices = action.payload;
    },
    clearError: (state) => {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    // initAuth
    builder.addCase(initAuth.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(initAuth.fulfilled, (state, action) => {
      state.isLoading = false;
      state.user = action.payload.user;
      state.minimalUser = action.payload.minimalUser;
      state.sessions = action.payload.sessions;
      state.activeSessionId = action.payload.activeSessionId;
      state.oxyServices = action.payload.oxyServices;
      state.isAuthenticated = !!action.payload.user;
    });
    builder.addCase(initAuth.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload || 'Failed to initialize auth';
      state.isAuthenticated = false;
      state.user = null;
      state.minimalUser = null;
      state.sessions = [];
      state.activeSessionId = null;
    });

    // login
    builder.addCase(login.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(login.fulfilled, (state, action) => {
      state.isLoading = false;
      state.user = action.payload.user;
      state.minimalUser = action.payload.minimalUser;
      state.sessions = action.payload.sessions;
      state.activeSessionId = action.payload.activeSessionId;
      state.isAuthenticated = true;
    });
    builder.addCase(login.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload || 'Login failed';
      state.isAuthenticated = false;
    });

    // logout
    builder.addCase(logout.pending, (state) => {
      state.isLoading = true; // Or a specific 'isLoggingOut' flag
    });
    builder.addCase(logout.fulfilled, (state, action) => {
      state.isLoading = false;
      state.user = action.payload.newActiveUser;
      state.minimalUser = action.payload.newMinimalUser;
      state.sessions = action.payload.newSessions;
      state.activeSessionId = action.payload.newActiveSessionId;
      state.isAuthenticated = !!action.payload.newActiveUser;
    });
    builder.addCase(logout.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload || 'Logout failed';
    });

    // logoutAll
    builder.addCase(logoutAll.pending, (state) => {
        state.isLoading = true;
    });
    builder.addCase(logoutAll.fulfilled, (state) => {
        state.isLoading = false;
        state.user = null;
        state.minimalUser = null;
        state.sessions = [];
        state.activeSessionId = null;
        state.isAuthenticated = false;
    });
    builder.addCase(logoutAll.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload || 'Logout all failed';
    });

    // signUp
    builder.addCase(signUp.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(signUp.fulfilled, (state, action) => {
      state.isLoading = false;
      state.user = action.payload.user;
      state.minimalUser = action.payload.minimalUser;
      state.sessions = action.payload.sessions;
      state.activeSessionId = action.payload.activeSessionId;
      state.isAuthenticated = true;
    });
    builder.addCase(signUp.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload || 'Sign up failed';
      state.isAuthenticated = false;
    });

    // switchSession
    builder.addCase(switchSession.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(switchSession.fulfilled, (state, action) => {
      state.isLoading = false;
      state.user = action.payload.user;
      state.minimalUser = action.payload.minimalUser;
      state.activeSessionId = action.payload.activeSessionId;
      state.isAuthenticated = true; // Assuming switch is always to a valid session
    });
    builder.addCase(switchSession.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload || 'Failed to switch session';
      // Decide if current auth state should be invalidated or kept
    });
  },
});

export const { setOxyServices, clearError } = authSlice.actions;
export default authSlice.reducer;

// Define a basic Storage interface that matches localStorage and AsyncStorage
// This is needed because the thunks now expect a 'storage' argument.
export interface Storage {
  getItem: (key: string) => Promise<string | null> | string | null;
  setItem: (key: string, value: string) => Promise<void> | void;
  removeItem: (key: string) => Promise<void> | void;
  clear?: () => Promise<void> | void;
}
