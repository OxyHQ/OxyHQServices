import { useMemo } from 'react';
import { useColorScheme } from './useColorScheme';
import { Colors } from '../constants/theme';

/**
 * Reusable hook to get theme colors based on current color scheme
 * Returns the Colors object for the current theme (light or dark)
 * 
 * @returns Colors object for the current color scheme
 * 
 * @example
 * ```tsx
 * const colors = useThemeColors();
 * <View style={{ backgroundColor: colors.background }}>
 *   <Text style={{ color: colors.text }}>Hello</Text>
 * </View>
 * ```
 */
export const useThemeColors = () => {
  const colorScheme = useColorScheme();
  
  return useMemo(() => {
    return Colors[colorScheme ?? 'light'];
  }, [colorScheme]);
};

