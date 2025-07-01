/**
 * Theme Store
 * Manages app-level theme preferences (safe to persist across users)
 * These are app-level settings, not user-specific settings
 */

import { create, StateCreator } from 'zustand';

// === THEME STATE INTERFACE ===

export interface ThemeState {
  // Theme preferences (app-level, safe to persist)
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

// === STORE SLICE ===

export const createThemeSlice: StateCreator<ThemeState> = (set, get) => ({
  // Initial state
  theme: 'auto',
  fontSize: 'medium',
  language: 'English',
  
  // === ACTIONS ===
  
  setTheme: (theme) => {
    console.log('[ThemeStore] Setting theme:', theme);
    set({ theme });
  },
  
  setFontSize: (fontSize) => {
    console.log('[ThemeStore] Setting font size:', fontSize);
    set({ fontSize });
  },
  
  setLanguage: (language) => {
    console.log('[ThemeStore] Setting language:', language);
    set({ language });
  },
  
  reset: () => {
    console.log('[ThemeStore] Resetting to defaults');
    set({
      theme: 'auto',
      fontSize: 'medium',
      language: 'English',
    });
  },
  
  // === COMPUTED VALUES ===
  
  getEffectiveTheme: () => {
    const { theme } = get();
    if (theme === 'auto') {
      // Detect system theme preference
      if (typeof window !== 'undefined' && window.matchMedia) {
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      return 'light'; // Default fallback
    }
    return theme;
  },
});

// === STANDALONE STORE ===
// NO PERSISTENCE - app-level theme settings (not user-specific)

export const useThemeStoreStandalone = create<ThemeState>()(
  createThemeSlice
); 