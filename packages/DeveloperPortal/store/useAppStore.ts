import { create } from 'zustand';

export interface DeveloperApp {
  id: string;
  name: string;
  description?: string;
  apiKey: string;
  webhookUrl: string;
  devWebhookUrl?: string;
  webhookSecret?: string;
  status: 'active' | 'suspended' | 'deleted';
  scopes: string[];
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

interface AppState {
  // State
  apps: DeveloperApp[];
  currentApp: DeveloperApp | null;
  loading: boolean;
  error: string | null;

  // Actions
  setApps: (apps: DeveloperApp[]) => void;
  addApp: (app: DeveloperApp) => void;
  updateApp: (id: string, updates: Partial<DeveloperApp>) => void;
  removeApp: (id: string) => void;
  setCurrentApp: (app: DeveloperApp | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

const initialState = {
  apps: [],
  currentApp: null,
  loading: false,
  error: null,
};

export const useAppStore = create<AppState>((set) => ({
  ...initialState,

  setApps: (apps) => set({ apps, error: null }),

  addApp: (app) => set((state) => ({
    apps: [app, ...state.apps],
    error: null,
  })),

  updateApp: (id, updates) => set((state) => ({
    apps: state.apps.map((app) =>
      app.id === id ? { ...app, ...updates } : app
    ),
    currentApp: state.currentApp?.id === id
      ? { ...state.currentApp, ...updates }
      : state.currentApp,
    error: null,
  })),

  removeApp: (id) => set((state) => ({
    apps: state.apps.filter((app) => app.id !== id),
    currentApp: state.currentApp?.id === id ? null : state.currentApp,
    error: null,
  })),

  setCurrentApp: (app) => set({ currentApp: app }),

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error }),

  clearError: () => set({ error: null }),

  reset: () => set(initialState),
}));
