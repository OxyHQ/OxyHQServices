/**
 * Bloom color preset utilities for the auth app.
 * Generates and applies CSS custom properties from bloom's color presets.
 */
import { APP_COLOR_PRESETS, type AppColorName } from '@oxyhq/bloom/color-presets';

function presetToCSS(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `  ${key}: hsl(${value});`)
    .join('\n');
}

/**
 * Returns a <style> string with :root and .dark CSS custom properties.
 * Used for early injection to prevent FOUC.
 */
export function getBloomThemeCSS(preset: AppColorName = 'oxy'): string {
  const p = APP_COLOR_PRESETS[preset];
  return `:root {\n${presetToCSS(p.light)}\n}\n.dark {\n${presetToCSS(p.dark)}\n}`;
}

/**
 * Apply a color preset's CSS custom properties to :root immediately.
 * Picks light or dark vars based on the current document class.
 */
export function applyColorPreset(preset: AppColorName): void {
  const config = APP_COLOR_PRESETS[preset];
  if (!config) return;

  const isDark = document.documentElement.classList.contains('dark');
  const vars = isDark ? config.dark : config.light;
  const root = document.documentElement.style;

  for (const [key, value] of Object.entries(vars)) {
    root.setProperty(key, `hsl(${value})`);
  }
}
