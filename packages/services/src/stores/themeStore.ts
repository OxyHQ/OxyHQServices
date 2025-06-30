/**
 * Theme store using Zustand
 * Centralized state management for theme preferences
 */

import { StateCreator } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { persist } from 'zustand/middleware';

export interface ThemeState {
  // Theme data
  theme: 'light' | 'dark' | 'auto';
  fontSize: 'small' | 'medium' | 'large';
  language: string;
  
  // Actions
  setTheme: (theme: 'light' | 'dark' | 'auto') => void;
  setFontSize: (fontSize: 'small' | 'medium' | 'large') => void;
  setLanguage: (language: string) => void;
  reset: () => void;
  
  // Computed values
  getEffectiveTheme: () => 'light' | 'dark';
}

export const createThemeSlice: StateCreator<ThemeState> = (set, get) => ({
  // Initial state
  theme: 'auto',
  fontSize: 'medium',
  language: 'en-US',
  
  // Actions
  setTheme: (theme: 'light' | 'dark' | 'auto') => {
    set({ theme });
  },
  
  setFontSize: (fontSize: 'small' | 'medium' | 'large') => {
    set({ fontSize });
  },
  
  setLanguage: (language: string) => {
    set({ language });
  },
  
  reset: () => {
    set({
      theme: 'auto',
      fontSize: 'medium',
      language: 'en-US',
    });
  },
  
  // Computed values
  getEffectiveTheme: () => {
    const { theme } = get();
    if (theme === 'auto') {
      // For now, default to light. In a real app, you'd detect system theme
      return 'light';
    }
    return theme;
  },
});

// Hook to use theme store
export const useThemeStore = () => {
  // This will be used when we integrate it into the main store
  // For now, we'll create a standalone store
  return null;
};

// Standalone theme store for now
import { create } from 'zustand';

export const useThemeStoreStandalone = create<ThemeState>()(
  persist(
    createThemeSlice,
    {
      name: 'theme-storage',
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
    }
  )
); 