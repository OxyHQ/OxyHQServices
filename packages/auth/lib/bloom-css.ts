/**
 * Generates CSS custom properties from bloom's color presets.
 * This keeps the auth app's colors in sync with the rest of the Oxy ecosystem.
 */
import { APP_COLOR_PRESETS, type AppColorName } from '@oxyhq/bloom/color-presets';

function presetToCSS(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: hsl(${value});`)
    .join('\n');
}

/**
 * Returns a <style> string with :root and .dark CSS custom properties
 * derived from a bloom color preset.
 */
export function getBloomThemeCSS(preset: AppColorName = 'oxy'): string {
  const p = APP_COLOR_PRESETS[preset];
  return `:root {\n${presetToCSS(p.light)}\n}\n.dark {\n${presetToCSS(p.dark)}\n}`;
}

/**
 * Returns the bloom preset's light and dark variable maps directly,
 * for use in inline style generation or server components.
 */
export function getBloomPreset(preset: AppColorName = 'oxy') {
  return APP_COLOR_PRESETS[preset];
}
