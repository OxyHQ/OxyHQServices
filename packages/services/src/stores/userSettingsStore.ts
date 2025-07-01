/**
 * User Settings Store
 * Manages user-specific settings fetched fresh from backend
 * NO PERSISTENCE - user settings are user-specific and should not persist across users
 */

import { StateCreator, create } from 'zustand';
import type { ApiUtils } from '../utils/api';

// === USER SETTINGS INTERFACE ===

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

  // Privacy settings
  profileVisibility: 'public' | 'private' | 'friends';
  showOnlineStatus: boolean;
  allowMessagesFrom: 'everyone' | 'friends' | 'none';
  showActivityStatus: boolean;

  // Notification settings
  pushNotifications: boolean;
  emailNotifications: boolean;
  marketingEmails: boolean;
  soundEnabled: boolean;

  // Security settings
  hasTwoFactorEnabled: boolean;
  lastPasswordChange?: string;
  activeSessions: number;

  // Account info (read-only)
  accountCreated: string;
  lastLogin: string;
}

// === STORE STATE INTERFACE ===

export interface UserSettingsState {
  // Data
  settings: UserSettings | null;
  
  // UI state
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  lastSync: number | null;
  isOffline: boolean;

  // State management
  setSettings: (settings: Partial<UserSettings>) => void;
  setLoading: (loading: boolean) => void;
  setSaving: (saving: boolean) => void;
  setError: (error: string | null) => void;
  setOffline: (offline: boolean) => void;
  reset: () => void;
  clearUserSettings: () => void;

  // Backend operations
  loadSettings: (apiUtils?: ApiUtils) => Promise<void>;
  saveSettings: (updates: Partial<UserSettings>, apiUtils?: ApiUtils) => Promise<void>;
  syncSettings: (apiUtils?: ApiUtils) => Promise<void>;
  refreshSettings: (apiUtils?: ApiUtils) => Promise<void>;
}

// === DEFAULT SETTINGS ===

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
  profileVisibility: 'public',
  showOnlineStatus: true,
  allowMessagesFrom: 'friends',
  showActivityStatus: true,
  pushNotifications: true,
  emailNotifications: true,
  marketingEmails: false,
  soundEnabled: true,
  hasTwoFactorEnabled: false,
  activeSessions: 1,
  accountCreated: '',
  lastLogin: '',
};

// === STORE SLICE ===

export const createUserSettingsSlice: StateCreator<UserSettingsState> = (set, get) => ({
  // Initial state
  settings: null,
  isLoading: false,
  isSaving: false,
  error: null,
  lastSync: null,
  isOffline: false,

  // === STATE MANAGEMENT ===

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

  clearUserSettings: () => {
    console.log('[UserSettingsStore] Clearing user settings');
    
    // Reset state
    get().reset();
    
    // Clear any legacy storage (cleanup for existing installations)
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('user-settings-storage');
        console.log('[UserSettingsStore] Cleared legacy user settings storage');
      }
    } catch (error) {
      console.warn('[UserSettingsStore] Failed to clear legacy storage:', error);
    }
  },

  // === BACKEND OPERATIONS ===

  loadSettings: async (apiUtils) => {
    if (!apiUtils) {
      console.warn('[UserSettingsStore] No API utils available - using default settings');
      set({ settings: defaultSettings, isOffline: true });
      return;
    }

    try {
      set({ isLoading: true, error: null });
      console.log('[UserSettingsStore] Loading settings from backend');

      const user = await apiUtils.getCurrentUser();
      if (user) {
        const settings = mapUserToSettings(user);
        set({ 
          settings, 
          isLoading: false, 
          lastSync: Date.now(),
          isOffline: false 
        });
        console.log('[UserSettingsStore] Settings loaded from backend');
      } else {
        set({ 
          settings: defaultSettings, 
          isLoading: false, 
          isOffline: true 
        });
      }

    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to load settings';
      console.error('[UserSettingsStore] Failed to load settings:', error);
      set({ 
        error: errorMessage, 
        isLoading: false, 
        isOffline: true,
        settings: defaultSettings
      });
    }
  },

  saveSettings: async (updates, apiUtils) => {
    if (!apiUtils) throw new Error('ApiUtils required for saving settings');

    try {
      set({ isSaving: true, error: null });
      console.log('[UserSettingsStore] Saving settings to backend');

      const updatedUser = await apiUtils.updateProfile(updates);
      const newSettings = mapUserToSettings(updatedUser);
      
      set({ 
        settings: newSettings, 
        isSaving: false, 
        lastSync: Date.now(),
        isOffline: false 
      });
      
      console.log('[UserSettingsStore] Settings saved to backend');

    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to save settings';
      console.error('[UserSettingsStore] Failed to save settings:', error);
      set({ 
        error: errorMessage, 
        isSaving: false 
      });
      throw error;
    }
  },

  syncSettings: async (apiUtils) => {
    if (!apiUtils) {
      console.warn('[UserSettingsStore] No API utils available for sync');
      return;
    }

    try {
      set({ isLoading: true, error: null });
      console.log('[UserSettingsStore] Syncing settings from backend');

      const user = await apiUtils.getCurrentUser();
      if (user) {
        const settings = mapUserToSettings(user);
        set({ 
          settings, 
          isLoading: false, 
          lastSync: Date.now(),
          isOffline: false 
        });
        console.log('[UserSettingsStore] Settings synced from backend');
      }

    } catch (error: any) {
      const errorMessage = error?.message || 'Failed to sync settings';
      console.error('[UserSettingsStore] Failed to sync settings:', error);
      set({ 
        error: errorMessage, 
        isLoading: false,
        isOffline: true 
      });
    }
  },

  refreshSettings: async (apiUtils) => {
    return get().syncSettings(apiUtils);
  },
});

// === HELPER FUNCTIONS ===

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
    profileVisibility: user.privacySettings?.profileVisibility ? 'public' : 'private',
    showOnlineStatus: user.privacySettings?.hideOnlineStatus ? false : true,
    allowMessagesFrom: user.privacySettings?.allowDirectMessages ? 'everyone' : 'friends',
    showActivityStatus: user.privacySettings?.showActivity !== false,
    pushNotifications: user.notificationSettings?.push !== false,
    emailNotifications: user.notificationSettings?.email !== false,
    marketingEmails: user.notificationSettings?.marketing || false,
    soundEnabled: user.notificationSettings?.sound !== false,
    hasTwoFactorEnabled: user.privacySettings?.twoFactorEnabled || false,
    lastPasswordChange: user.lastPasswordChange,
    activeSessions: user.activeSessions || 1,
    accountCreated: user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '',
    lastLogin: user.lastLogin || 'Today',
  };
}

// === STANDALONE STORE ===
// NO PERSISTENCE - user settings are user-specific and should not persist

export const useUserSettingsStore = create<UserSettingsState>()(
  createUserSettingsSlice
); 