/**
 * Color Utility Functions
 *
 * Consolidated color manipulation utilities used across the OxyServices ecosystem.
 * These functions work in any JavaScript environment (browser, Node.js, React Native).
 *
 * @module shared/utils/colorUtils
 */

/**
 * Darkens a hex color by a specified factor.
 *
 * @param color - Hex color string (with or without #)
 * @param factor - Amount to darken (0-1). Default: 0.6
 * @returns Darkened hex color string with # prefix
 *
 * @example
 * ```ts
 * darkenColor('#FF0000', 0.5); // Returns a darker red
 * darkenColor('FF0000', 0.3);  // Also works without #
 * ```
 */
export const darkenColor = (color: string, factor: number = 0.6): string => {
  const hex = color.replace('#', '');

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const newR = Math.max(0, Math.round(r * (1 - factor)));
  const newG = Math.max(0, Math.round(g * (1 - factor)));
  const newB = Math.max(0, Math.round(b * (1 - factor)));

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
};

/**
 * Lightens a hex color by a specified factor.
 *
 * @param color - Hex color string (with or without #)
 * @param factor - Amount to lighten (0-1). Default: 0.3
 * @returns Lightened hex color string with # prefix
 *
 * @example
 * ```ts
 * lightenColor('#0000FF', 0.5); // Returns a lighter blue
 * ```
 */
export const lightenColor = (color: string, factor: number = 0.3): string => {
  const hex = color.replace('#', '');

  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  const newR = Math.min(255, Math.round(r + (255 - r) * factor));
  const newG = Math.min(255, Math.round(g + (255 - g) * factor));
  const newB = Math.min(255, Math.round(b + (255 - b) * factor));

  return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
};

/**
 * Converts a hex color to RGB values.
 *
 * @param hex - Hex color string (with or without #)
 * @returns Object with r, g, b values (0-255)
 *
 * @example
 * ```ts
 * hexToRgb('#FF5733'); // { r: 255, g: 87, b: 51 }
 * ```
 */
export const hexToRgb = (hex: string): { r: number; g: number; b: number } | null => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
};

/**
 * Converts RGB values to a hex color string.
 *
 * @param r - Red value (0-255)
 * @param g - Green value (0-255)
 * @param b - Blue value (0-255)
 * @returns Hex color string with # prefix
 *
 * @example
 * ```ts
 * rgbToHex(255, 87, 51); // '#ff5733'
 * ```
 */
export const rgbToHex = (r: number, g: number, b: number): string => {
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
};

/**
 * Adjusts the opacity of a hex color, returning an rgba string.
 *
 * @param hex - Hex color string
 * @param opacity - Opacity value (0-1)
 * @returns RGBA color string
 *
 * @example
 * ```ts
 * withOpacity('#FF0000', 0.5); // 'rgba(255, 0, 0, 0.5)'
 * ```
 */
export const withOpacity = (hex: string, opacity: number): string => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`;
};

/**
 * Checks if a color is considered "light" (for determining text contrast).
 *
 * @param hex - Hex color string
 * @returns true if the color is light, false if dark
 *
 * @example
 * ```ts
 * isLightColor('#FFFFFF'); // true
 * isLightColor('#000000'); // false
 * ```
 */
export const isLightColor = (hex: string): boolean => {
  const rgb = hexToRgb(hex);
  if (!rgb) return true;

  // Using relative luminance formula
  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return luminance > 0.5;
};

/**
 * Gets a contrasting text color (black or white) for a given background color.
 *
 * @param backgroundColor - Hex color string of the background
 * @returns '#000000' for light backgrounds, '#ffffff' for dark backgrounds
 *
 * @example
 * ```ts
 * getContrastTextColor('#FFFF00'); // '#000000' (black text on yellow)
 * getContrastTextColor('#000080'); // '#ffffff' (white text on navy)
 * ```
 */
export const getContrastTextColor = (backgroundColor: string): string => {
  return isLightColor(backgroundColor) ? '#000000' : '#ffffff';
};
