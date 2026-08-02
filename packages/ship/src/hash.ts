import crypto from 'node:crypto';

/** Lowercase-hex SHA-256 of a buffer — the content address used by Oxy Updates. */
export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

/**
 * Lowercase-hex MD5 of a buffer — the expo-export asset `key`. The client uses
 * this key to reference assets and to skip ones already embedded in the binary,
 * so it MUST match exactly what `expo export` names the on-disk asset.
 */
export function md5Hex(bytes: Buffer): string {
  return crypto.createHash('md5').update(bytes).digest('hex');
}

/**
 * MIME type for an expo-export asset extension (no leading dot). Covers the
 * asset kinds `expo export` emits; anything unknown falls back to a binary type.
 * The JS bundle (launch asset) is always `application/javascript` and is handled
 * by the caller, not here.
 */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  js: 'application/javascript',
  json: 'application/json',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  eot: 'application/vnd.ms-fontobject',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  aac: 'audio/aac',
  m4a: 'audio/mp4',
  lottie: 'application/json',
  db: 'application/octet-stream',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
  xml: 'application/xml',
  pdf: 'application/pdf',
};

export function contentTypeForExt(ext: string): string {
  const normalized = ext.replace(/^\./, '').toLowerCase();
  return CONTENT_TYPE_BY_EXT[normalized] ?? 'application/octet-stream';
}
