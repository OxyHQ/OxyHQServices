/**
 * QR rendering helper for the IdP's "Sign in with Oxy" screen.
 *
 * `qrcode` is loaded lazily via dynamic `import()` so it stays out of the auth
 * app's critical-path bundle until the QR option is actually shown.
 */

interface QrCodeModule {
  toDataURL(
    text: string,
    options?: {
      margin?: number
      width?: number
      errorCorrectionLevel?: "L" | "M" | "Q" | "H"
      color?: { dark?: string; light?: string }
    },
  ): Promise<string>
}

/**
 * Render a payload string to a PNG `data:` URL suitable for an `<img src>`.
 *
 * @param payload - The QR payload (`oxycommons://approve?...`).
 * @param width - Output image width in pixels (default 232).
 */
export async function renderQrDataUrl(payload: string, width = 232): Promise<string> {
  const mod = await import("qrcode")
  const qr: QrCodeModule =
    (mod as unknown as { default?: QrCodeModule }).default ??
    (mod as unknown as QrCodeModule)
  return qr.toDataURL(payload, {
    width,
    margin: 1,
    errorCorrectionLevel: "M",
  })
}
