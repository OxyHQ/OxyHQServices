/**
 * User Settings store using Zustand
 * Centralized state management for user settings (separate from authentication)
 * Implements backend-first data management with local fallback
 */

import { StateCreator, create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist } from 'zustand/middleware';
import type { ApiUtils } from '../utils/api';

export interface UserSettings {
  // Profile settings
  username: string;
  email: string;
  bio: string;
  description: string;
  location: string;
  avatar: {
    id: string;
    url: string;
  };
  name: {
    first: string;
    middle: string;
    last: string;
  };
  addresses: Array<{
    id: string;
    formatted: string;
    street: string;
    city: string;
    state: string;
    country: string;
    postalCode: string;
    latitude?: number;
    longitude?: number;
  }>;
  links: Array<{
    url: string;
    title?: string;
    description?: string;
    image?: string;
  }>;

  // Appearance settings
  theme: 'light' | 'dark' | 'auto';
  fontSize: 'small' | 'medium' | 'large';
  language: string;

  // Notification settings
  pushNotifications: boolean;
  emailNotifications: boolean;
  marketingEmails: boolean;
  soundEnabled: boolean;

  // Privacy settings
  profileVisibility: 'public' | 'private' | 'friends';
  showOnlineStatus: boolean;
  allowMessagesFrom: 'everyone' | 'friends' | 'none';
  showActivityStatus: boolean;

  // Security settings
  hasTwoFactorEnabled: boolean;
  lastPasswordChange?: string;
  activeSessions: number;

  // Account info
  accountCreated: string;
  lastLogin: string;
}

export interface UserSettingsState {
  // Settings data
  settings: UserSettings | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSync: number | null;
  isOffline: boolean;

  // Actions
  setSettings: (settings: Partial<UserSettings>) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  setOffline: (offline: boolean) => void;
  reset: () => void;

  // Async actions
  loadSettings: (apiUtils?: ApiUtils) => Promise<void>;
  saveSettings: (updates: Partial<UserSettings>, apiUtils?: ApiUtils) => Promise<void>;
  syncSettings: (apiUtils?: ApiUtils) => Promise<void>;
  refreshSettings: (apiUtils?: ApiUtils) => Promise<void>;
}

const defaultSettings: UserSettings = {
  username: '',
  email: '',
  bio: '',
  description: '',
  location: '',
  avatar: { id: '', url: '' },
  name: { first: '', middle: '', last: '' },
  addresses: [],
  links: [],
  theme: 'auto',
  fontSize: 'medium',
  language: 'English',
  pushNotifications: true,
  emailNotifications: true,
  marketingEmails: false,
  soundEnabled: true,
  profileVisibility: 'public',
  showOnlineStatus: true,
  allowMessagesFrom: 'friends',
  showActivityStatus: true,
  hasTwoFactorEnabled: false,
  activeSessions: 1,
  accountCreated: '',
  lastLogin: '',
};

export const createUserSettingsSlice: StateCreator<UserSettingsState> = (set, get) => ({
  // Initial state
  settings: null,
  isLoading: false,
  isSaving: false,
  error: null,
  lastSync: null,
  isOffline: false,

  // Actions
  setSettings: (settings) => {
    const currentSettings = get().settings;
    set({
      settings: currentSettings ? { ...currentSettings, ...settings } : settings as UserSettings,
      lastSync: Date.now(),
    });
  },

  setLoading: (isLoading) => set({ isLoading }),
  setSaving: (isSaving) => set({ isSaving }),
  setError: (error) => set({ error }),
  setOffline: (isOffline) => set({ isOffline }),

  reset: () => set({
    settings: null,
    isLoading: false,
    isSaving: false,
    error: null,
    lastSync: null,
    isOffline: false,
  }),

  // Load settings from backend first, fallback to local storage
  loadSettings: async (apiUtils) => {
    const state = get();
    
    try {
      set({ isLoading: true, error: null });

      if (apiUtils) {
        // Try to load from backend first
        try {
          const user = await apiUtils.getCurrentUser();
          if (user) {
            const settings = mapUserToSettings(user);
            set({ 
              settings, 
              isLoading: false, 
              lastSync: Date.now(),
              isOffline: false 
            });
            return;
          }
        } catch (error) {
          console.warn('Failed to load settings from backend, using local fallback:', error);
          set({ isOffline: true });
        }
      }

      // Fallback to local storage if backend fails or no API utils
      if (state.settings) {
        set({ isLoading: false, isOffline: true });
        return;
      }

      // No local settings either, use defaults
      set({ 
        settings: defaultSettings, 
        isLoading: false, 
        isOffline: true 
      });

    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to load settings';
      set({ 
        error: errorMessage, 
        isLoading: false, 
        isOffline: true 
      });
    }
  },

  // Save settings to backend first, then update local state
  saveSettings: async (updates, apiUtils) => {
    const state = get();
    
    try {
      set({ isSaving: true, error: null });

      if (apiUtils) {
        // Save to backend first
        try {
          const updatedUser = await apiUtils.updateProfile(updates);
          const newSettings = mapUserToSettings(updatedUser);
          
          set({ 
            settings: newSettings, 
            isSaving: false, 
            lastSync: Date.now(),
            isOffline: false 
          });
          return;
        } catch (error) {
          console.warn('Failed to save settings to backend, saving locally only:', error);
          set({ isOffline: true });
        }
      }

      // Fallback to local-only save if backend fails
      const currentSettings = state.settings || defaultSettings;
      const newSettings = { ...currentSettings, ...updates };
      
      set({ 
        settings: newSettings, 
        isSaving: false, 
        isOffline: true 
      });

    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to save settings';
      set({ 
        error: errorMessage, 
        isSaving: false 
      });
      throw error;
    }
  },

  // Sync settings with backend (refresh from server)
  syncSettings: async (apiUtils) => {
    if (!apiUtils) {
      console.warn('No API utils available for sync');
      return;
    }

    try {
      set({ isLoading: true, error: null });

      const user = await apiUtils.getCurrentUser();
      if (user) {
        const settings = mapUserToSettings(user);
        set({ 
          settings, 
          isLoading: false, 
          lastSync: Date.now(),
          isOffline: false 
        });
      }

    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to sync settings';
      set({ 
        error: errorMessage, 
        isLoading: false,
        isOffline: true 
      });
    }
  },

  // Refresh settings (alias for sync)
  refreshSettings: async (apiUtils) => {
    return get().syncSettings(apiUtils);
  },
});

// Helper function to map User object to UserSettings
function mapUserToSettings(user: any): UserSettings {
  return {
    username: user.username || '',
    email: user.email || '',
    bio: user.bio || '',
    description: user.description || '',
    location: user.location || '',
    avatar: user.avatar || { id: '', url: '' },
    name: user.name || { first: '', middle: '', last: '' },
    addresses: user.addresses || [],
    links: user.links || [],
    theme: user.theme || 'auto',
    fontSize: user.fontSize || 'medium',
    language: user.language || 'English',
    pushNotifications: user.pushNotifications !== false,
    emailNotifications: user.emailNotifications !== false,
    marketingEmails: user.marketingEmails || false,
    soundEnabled: user.soundEnabled !== false,
    profileVisibility: user.profileVisibility || 'public',
    showOnlineStatus: user.showOnlineStatus !== false,
    allowMessagesFrom: user.allowMessagesFrom || 'friends',
    showActivityStatus: user.showActivityStatus !== false,
    hasTwoFactorEnabled: user.hasTwoFactorEnabled || false,
    lastPasswordChange: user.lastPasswordChange,
    activeSessions: user.activeSessions || 1,
    accountCreated: user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '',
    lastLogin: user.lastLogin || 'Today',
  };
}

// Standalone user settings store
export const useUserSettingsStore = create<UserSettingsState>()(
  persist(
    createUserSettingsSlice,
    {
      name: 'user-settings-storage',
      storage: {
        getItem: async (name) => {
          const value = await AsyncStorage.getItem(name);
          return value ? JSON.parse(value) : null;
        },
        setItem: async (name, value) => {
          await AsyncStorage.setItem(name, JSON.stringify(value));
        },
        removeItem: async (name) => {
          await AsyncStorage.removeItem(name);
        },
      },
      partialize: (state) => {
        const partialized: Partial<UserSettingsState> = {};
        if (state.settings) partialized.settings = state.settings;
        if (state.lastSync) partialized.lastSync = state.lastSync;
        partialized.isOffline = state.isOffline;
        return partialized;
      },
    }
  )
); 