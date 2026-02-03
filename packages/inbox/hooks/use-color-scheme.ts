import { useThemeContext } from '@/contexts/theme-context';

export function useColorScheme() {
  const { resolvedTheme } = useThemeContext();
  return resolvedTheme;
}
