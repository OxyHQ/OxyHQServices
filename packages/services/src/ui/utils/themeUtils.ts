/**
 * Theme Utility Functions
 *
 * @deprecated Import from '@oxyhq/services/shared' instead
 * @module ui/utils/themeUtils
 *
 * This file re-exports from the consolidated shared module for backward compatibility.
 */

export {
  normalizeTheme,
  normalizeColorScheme,
  getOppositeTheme,
  systemPrefersDarkMode,
  getSystemColorScheme,
} from '../../shared/utils/themeUtils.js';

export type { ThemeValue } from '../../shared/utils/themeUtils.js';
