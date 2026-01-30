/**
 * Color Utility Functions
 *
 * Re-exports from shared module for cleaner internal imports.
 * External consumers should use '@oxyhq/services/shared' directly.
 *
 * @module ui/utils/colorUtils
 */

export {
  darkenColor,
  lightenColor,
  hexToRgb,
  rgbToHex,
  withOpacity,
  isLightColor,
  getContrastTextColor,
} from '@oxyhq/core';
