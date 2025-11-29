import { useMemo } from 'react';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export interface ThemeColors {
  background: string;
  text: string;
  primary: string;
  tint: string;
}

export interface Theme {
  colors: ThemeColors;
  mode: 'light' | 'dark';
}

export function useTheme(): Theme {
  const colorScheme = useColorScheme();
  const mode = (colorScheme ?? 'light') as 'light' | 'dark';
  const colors = Colors[mode];

  return useMemo<Theme>(() => ({
    mode,
    colors: {
      background: colors.background,
      text: colors.text,
      primary: colors.tint,
      tint: colors.tint,
    },
  }), [mode, colors]);
}

