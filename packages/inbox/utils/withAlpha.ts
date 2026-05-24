/**
 * `withAlpha(color, alpha)` — add an alpha channel to any CSS-style color
 * string and return a canonical `rgba(...)` representation.
 *
 * Replaces the ad-hoc `#RRGGBB` + hex-suffix string concatenation pattern
 * scattered across the inbox UI (e.g. `${colors.primary}1A`) which:
 *   - Silently breaks on `#RGB` shorthand (only 3 hex chars after `#`).
 *   - Silently breaks on `rgb()` / `rgba()` / `hsl()` / `hsla()` inputs.
 *   - Produces invalid CSS when the base color already has 8 hex chars.
 *   - Computes incorrect alpha for non-hex pixels of two-digit clarity.
 *
 * Accepted inputs:
 *   - `#RGB`            (e.g. `#fa3`)
 *   - `#RRGGBB`         (e.g. `#ff4433`)
 *   - `#RGBA`           (e.g. `#fa38`)
 *   - `#RRGGBBAA`       (e.g. `#ff443388`)
 *   - `rgb(r, g, b)`    / `rgb(r g b)`
 *   - `rgba(r, g, b, a)`/ `rgba(r g b / a)`
 *   - `hsl(...)` / `hsla(...)` — passed through and given `/ {alpha}` slash
 *     syntax. (The CSS color-functional alpha override applies in all
 *     modern engines, including RN web and React Native's Skia-backed
 *     parser.)
 *
 * The function silently passes the original string through (with a console
 * warning in `__DEV__` mode) if the input does not match a known pattern;
 * this keeps the UI from crashing on novel color formats while making the
 * mismatch debuggable.
 *
 * @param color The base color string.
 * @param alpha A number in the inclusive range `[0, 1]`. Values outside the
 *              range are clamped.
 * @returns A CSS color string with the requested alpha applied.
 *
 * @example
 *   withAlpha('#1A73E8', 0.1)     // -> 'rgba(26, 115, 232, 0.1)'
 *   withAlpha('#f80', 0.5)        // -> 'rgba(255, 136, 0, 0.5)'
 *   withAlpha('rgb(10,20,30)', 0.4)
 *   withAlpha('hsl(200 50% 50%)', 0.2)  // -> 'hsl(200 50% 50% / 0.2)'
 */
export function withAlpha(color: string, alpha: number): string {
  const a = clamp01(alpha);
  const input = color.trim();

  // ── #RGB / #RGBA / #RRGGBB / #RRGGBBAA ────────────────────────────
  if (input.startsWith('#')) {
    const hex = input.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseHexByte(hex[0] + hex[0]);
      const g = parseHexByte(hex[1] + hex[1]);
      const b = parseHexByte(hex[2] + hex[2]);
      if (r !== null && g !== null && b !== null) {
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      }
    } else if (hex.length === 6 || hex.length === 8) {
      const r = parseHexByte(hex.slice(0, 2));
      const g = parseHexByte(hex.slice(2, 4));
      const b = parseHexByte(hex.slice(4, 6));
      if (r !== null && g !== null && b !== null) {
        return `rgba(${r}, ${g}, ${b}, ${a})`;
      }
    }
  }

  // ── rgb(...) / rgba(...) ──────────────────────────────────────────
  const rgbMatch = input.match(/^rgba?\s*\(\s*([0-9.]+)[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
  if (rgbMatch) {
    const r = clampByte(Number(rgbMatch[1]));
    const g = clampByte(Number(rgbMatch[2]));
    const b = clampByte(Number(rgbMatch[3]));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  // ── hsl(...) / hsla(...) — pass through with slash-alpha syntax ──
  const hslMatch = input.match(/^hsla?\s*\(\s*(.+?)\s*[)/]/i);
  if (hslMatch) {
    return `hsl(${hslMatch[1]} / ${a})`;
  }

  if (__DEV__) {
    console.warn(`[withAlpha] Unrecognised color input: ${color}`);
  }
  return color;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 255) return 255;
  return Math.round(v);
}

function parseHexByte(hex: string): number | null {
  if (hex.length !== 2) return null;
  const n = Number.parseInt(hex, 16);
  return Number.isFinite(n) ? n : null;
}
