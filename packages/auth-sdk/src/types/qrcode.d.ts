/**
 * Minimal ambient type for the `qrcode` package, scoped to the single function
 * `@oxyhq/auth` actually calls (`toDataURL`). The published `qrcode` package
 * ships no bundled types and we deliberately avoid pulling `@types/qrcode`
 * (which declares the full Node stream/file surface we never touch).
 *
 * Validated against `qrcode@1.5.x` (`node_modules/qrcode/lib/index.js` →
 * `toDataURL(text, options) => Promise<string>`). `qrcode` is loaded lazily via
 * `await import('qrcode')` so it stays out of the module graph until a consumer
 * actually renders a "Sign in with Oxy" QR.
 */
declare module 'qrcode' {
  export interface QRCodeToDataURLOptions {
    /** Quiet-zone size in modules (default 4). */
    margin?: number;
    /** Output image width in pixels. */
    width?: number;
    /** Error-correction level (default 'M'). */
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    /** Foreground / background colors as `#rrggbbaa` hex strings. */
    color?: { dark?: string; light?: string };
  }

  export function toDataURL(
    text: string,
    options?: QRCodeToDataURLOptions,
  ): Promise<string>;
}
