import { buildCdnUrl } from '../../config/cdn';

/**
 * Content-addressed storage layout for Oxy Update assets. Both the publish
 * service (which writes the objects) and the manifest service (which serves
 * their URLs) derive these purely from an asset's SHA-256, so an asset URL is a
 * deterministic function of its content and never needs a DB lookup on the hot
 * manifest path.
 *
 * Objects live under the media bucket's `public/` prefix so the existing
 * `cloud.oxy.so` CloudFront distribution serves them with no infra change.
 */
export const UPDATE_ASSET_KEY_PREFIX = 'public/updates/assets/';

/** S3 object key for an asset: `public/updates/assets/<sha256-hex>`. */
export function updateAssetS3Key(sha256: string): string {
  return `${UPDATE_ASSET_KEY_PREFIX}${sha256}`;
}

/** Public CDN URL for an asset: `https://cloud.oxy.so/updates/assets/<sha256-hex>`. */
export function updateAssetCdnUrl(sha256: string): string {
  return buildCdnUrl(`updates/assets/${sha256}`);
}

/** Base64URL-encode the RAW bytes of a hex SHA-256 (the manifest `hash` field). */
export function sha256HexToBase64Url(sha256Hex: string): string {
  return Buffer.from(sha256Hex, 'hex')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
