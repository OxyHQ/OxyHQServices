/**
 * QR rendering helper for the web "Sign in with Oxy" handoff.
 *
 * `qrcode` is loaded lazily via dynamic `import()` so it never enters the
 * module graph unless a consumer actually renders a QR — keeping the headless
 * `@oxyhq/auth` bundle lean for apps that only use redirect / SSO auth.
 *
 * ESM/CJS safety: a dynamic `import('qrcode')` stays an `import()` in the ESM
 * build (no bare `require`, per the package's ESM contract) and transpiles to a
 * `require` only in the CJS build (where `require` is allowed).
 */

/** Minimal structural shape of the lazily-imported `qrcode` module. */
interface QrCodeModule {
  toDataURL(
    text: string,
    options?: {
      margin?: number;
      width?: number;
      errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
      color?: { dark?: string; light?: string };
    },
  ): Promise<string>;
}

/**
 * Render a payload string to a PNG `data:` URL suitable for an `<img src>`.
 *
 * @param payload - The deep-link / QR payload (`oxycommons://approve?...`).
 * @param width - Output image width in pixels (default 240).
 * @returns A PNG data URL encoding `payload`.
 */
export async function renderQrDataUrl(payload: string, width = 240): Promise<string> {
  const mod = await import('qrcode');
  // CJS interop: a bundler may expose the module under `default` or flat.
  const qr: QrCodeModule =
    (mod as unknown as { default?: QrCodeModule }).default ??
    (mod as unknown as QrCodeModule);
  return qr.toDataURL(payload, {
    width,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
}
