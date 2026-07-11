/**
 * Color helpers that are safe for every Bloom theme-token format.
 *
 * Bloom emits native `theme.colors` values as modern `rgb(r g b)` strings and
 * only the four status colors as `#RRGGBB` hex. Naive `` `${color}1F` ``
 * alpha-concatenation produces a valid value ONLY for the hex colors and an
 * invalid (transparent / black) value for the far more common `rgb(...)` tokens
 * — which renders as an empty dark blob on native. These helpers parse both and
 * emit universally-supported color strings.
 */

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse a `#RRGGBB` / `#RGB` / `rgb()` / `rgba()` string into channels, or null. */
function parseRgb(color: string): Rgb | null {
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const value = hex[1];
    const full =
      value.length === 3
        ? value
            .split('')
            .map((char) => char + char)
            .join('')
        : value;
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  const rgb = color.match(/rgba?\(([^)]+)\)/i);
  if (rgb) {
    const [r, g, b] = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      return { r, g, b };
    }
  }

  return null;
}

/** Clamp `t` to [0, 1]. */
function clamp01(t: number): number {
  if (Number.isNaN(t)) return 0;
  return Math.min(Math.max(t, 0), 1);
}

/**
 * Return `color` with the given `alpha` (0–1) as an `rgba(r, g, b, a)` string.
 * Falls back to the input unchanged if it can't be parsed.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = parseRgb(color);
  if (!c) return color;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

/**
 * Linearly interpolate between two colors, `t` in [0, 1] (`0` → `a`, `1` → `b`).
 * Used to build a related-tonality ramp (e.g. success → info) across the
 * distribution bar's category segments. Emits modern `rgb(r g b)`.
 */
export function mixColors(a: string, b: string, t: number): string {
  const ca = parseRgb(a);
  const cb = parseRgb(b);
  if (!ca || !cb) return a;
  const amount = clamp01(t);
  const lerp = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `rgb(${lerp(ca.r, cb.r)} ${lerp(ca.g, cb.g)} ${lerp(ca.b, cb.b)})`;
}
