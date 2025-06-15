import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { User } from '../../models/interfaces';
import { SecureClientSession, MinimalUserData } from '../../models/secureSession';

export interface AuthState {
  // Authentication state
  user: User | null;
  minimalUser: MinimalUserData | null;
  sessions: SecureClientSession[];
  activeSessionId: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  setUser: (user: User | null) => void;
  setMinimalUser: (minimalUser: MinimalUserData | null) => void;
  setSessions: (sessions: SecureClientSession[]) => void;
  setActiveSessionId: (sessionId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setAuthenticated: (authenticated: boolean) => void;
  
  // Computed helpers
  getSessionById: (sessionId: string) => SecureClientSession | undefined;
  removeSessionById: (sessionId: string) => void;
  addSession: (session: SecureClientSession) => void;
  updateSession: (sessionId: string, updates: Partial<SecureClientSession>) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    user: null,
    minimalUser: null,
    sessions: [],
    activeSessionId: null,
    isAuthenticated: false,
    isLoading: false,
    error: null,

    // Actions
    setUser: (user) => set({ user }),
    setMinimalUser: (minimalUser) => set({ minimalUser }),
    setSessions: (sessions) => set({ sessions }),
    setActiveSessionId: (activeSessionId) => set({ activeSessionId }),
    setLoading: (isLoading) => set({ isLoading }),
    setError: (error) => set({ error }),
    setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

    // Computed helpers
    getSessionById: (sessionId) => {
      const { sessions } = get();
      return sessions.find(s => s.sessionId === sessionId);
    },

    removeSessionById: (sessionId) => {
      const { sessions } = get();
      const updatedSessions = sessions.filter(s => s.sessionId !== sessionId);
      set({ sessions: updatedSessions });
    },

    addSession: (session) => {
      const { sessions } = get();
      const existingIndex = sessions.findIndex(s => s.sessionId === session.sessionId);
      
      if (existingIndex >= 0) {
        // Update existing session
        const updatedSessions = [...sessions];
        updatedSessions[existingIndex] = session;
        set({ sessions: updatedSessions });
      } else {
        // Add new session
        set({ sessions: [...sessions, session] });
      }
    },

    updateSession: (sessionId, updates) => {
      const { sessions } = get();
      const updatedSessions = sessions.map(s => 
        s.sessionId === sessionId ? { ...s, ...updates } : s
      );
      set({ sessions: updatedSessions });
    },

    clearAuth: () => set({
      user: null,
      minimalUser: null,
      sessions: [],
      activeSessionId: null,
      isAuthenticated: false,
      error: null
    }),
  }))
);