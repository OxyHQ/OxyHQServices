import { useThemeContext } from '@/contexts/theme-context';

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 * Now uses ThemeContext which loads theme synchronously from localStorage to prevent flash
 */
export function useColorScheme() {
  const { resolvedTheme, isLoaded } = useThemeContext();
  
  // Return the resolved theme, or 'light' as fallback if not loaded yet (shouldn't happen on web)
  return isLoaded ? resolvedTheme : 'light';
}
