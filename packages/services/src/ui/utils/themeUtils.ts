/**
 * Theme Utility Functions
 *
 * Re-exports from shared module for cleaner internal imports.
 * External consumers should use '@oxyhq/services/shared' directly.
 *
 * @module ui/utils/themeUtils
 */

export {
  normalizeTheme,
  normalizeColorScheme,
  getOppositeTheme,
  systemPrefersDarkMode,
  getSystemColorScheme,
} from '@oxyhq/core';

export type { ThemeValue } from '@oxyhq/core';
