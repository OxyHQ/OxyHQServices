import React, { createContext, useContext, ReactNode } from 'react';

type ResolvedTheme = 'light' | 'dark';

interface ThemeContextType {
  resolvedTheme: ResolvedTheme;
  isLoaded: boolean;
}

export const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  theme: 'light' | 'dark';
  children: ReactNode;
}

/**
 * ThemeProvider component that accepts a theme prop and provides it via context.
 * This allows Accounts-style components to access theme through hooks.
 */
export function ThemeProvider({ theme, children }: ThemeProviderProps) {
  return (
    <ThemeContext.Provider
      value={{
        resolvedTheme: theme,
        isLoaded: true,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useThemeContext must be used within a ThemeProvider');
  }
  return context;
}

