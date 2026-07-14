/**
 * Whitespace normalization for the STRUCTURED profile fields — `linksMetadata`,
 * `locations`, `links`.
 *
 * WHY THESE NEED THEIR OWN PASS
 * -----------------------------
 * `sanitizeProfileUpdate` only walks the TOP-LEVEL string values of a profile
 * update (`bio`, `description`, `address`, …) and deliberately skips these three
 * because they are arrays of structured objects, not free text. The result was
 * that the only profile fields carrying THIRD-PARTY text — the `<title>` /
 * `og:description` of a scraped remote page (`linksMetadata`) and the
 * Nominatim `display_name` of a geocoded place (`locations`) — were the only
 * ones stored exactly as the remote source wrote them.
 *
 * A remote page that serves
 *
 *     <title>
 *       Mi título
 *     </title>
 *
 * put a real newline plus six spaces of indentation into `linksMetadata[].title`,
 * and clients render that in a React Native `Text` (`white-space: pre-wrap` on
 * web), which does NOT collapse whitespace the way HTML does — so the profile
 * showed a blank line and an indent inside the link card.
 *
 * Every value normalized here is a ONE-LINE display value (a card title, a place
 * name, a URL), so they all go through the canonical `normalizeInlineText`: a
 * line break in any of them is always an artifact of the source, never authored
 * intent.
 *
 * These normalizers run in the profile WRITE SERVICE (`user.service`), not in a
 * Mongoose setter: the write service is where the rest of the profile's
 * boundary validation already lives (display-name policy, locale canonicalization,
 * premium-color gate), and it is the layer that can reject a malformed payload
 * with a structured 400. A setter would silently fix up documents from every
 * internal caller and hide the same class of bug from tests.
 *
 * Length caps are applied here too: these are display strings coming from a
 * remote origin that we do not control, so an unbounded `og:description` cannot
 * be allowed to grow a user document without limit.
 */

import { normalizeInlineText } from '@oxyhq/core';

/** Max stored length of a link card's title, in code units after normalization. */
export const MAX_LINK_TITLE_LENGTH = 200;

/** Max stored length of a link card's description. */
export const MAX_LINK_DESCRIPTION_LENGTH = 500;

/** Max stored length of a location's `name` / `label` and its address parts. */
export const MAX_LOCATION_TEXT_LENGTH = 200;

/** Max stored length of a profile link URL (matches the link-preview URL bound). */
export const MAX_LINK_URL_LENGTH = 2048;

/**
 * The address leaves of a `locations[]` entry. All of them are single-line
 * display values, and `formattedAddress` is Nominatim's raw `display_name`.
 */
const LOCATION_ADDRESS_TEXT_KEYS = [
  'street',
  'streetNumber',
  'streetDetails',
  'postalCode',
  'city',
  'state',
  'country',
  'formattedAddress',
] as const;

/** A JSON object reached through an `unknown` payload (the profile update body). */
type UnknownRecord = Record<string, unknown>;

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize a single-line display value and cap its length, trimming again in
 * case the cut landed on a boundary space.
 */
export function normalizeDisplayValue(value: string, maxLength: number): string {
  const normalized = normalizeInlineText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return normalized.slice(0, maxLength).trim();
}

/**
 * Normalize the string leaves of an object IN PLACE-free fashion: returns a new
 * object with `keys` normalized and every other key passed through untouched.
 * Keys that are absent, or hold a non-string, are left exactly as they were —
 * this function normalizes text, it does not validate shape.
 */
function withNormalizedKeys(
  source: UnknownRecord,
  keys: readonly string[],
  maxLength: number
): UnknownRecord {
  const result: UnknownRecord = { ...source };
  for (const key of keys) {
    const value = result[key];
    if (typeof value === 'string') {
      result[key] = normalizeDisplayValue(value, maxLength);
    }
  }
  return result;
}

/**
 * Normalize `linksMetadata[]`: the `title` / `description` scraped from a remote
 * page, and the `url` itself.
 *
 * Entries left over from a malformed payload — a non-object, or an entry whose
 * URL normalizes to nothing — are dropped: a link card with no URL is not a
 * link. Empty title/description are NOT invented here; the `linkMetadata`
 * controller already fills them from the URL when the remote page provides
 * neither, and the User schema requires them.
 *
 * A non-array input is returned untouched so the caller's own validation (or the
 * schema) reports the type error rather than this normalizer silently swallowing it.
 */
export function normalizeLinksMetadata(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const normalized: unknown[] = [];
  for (const entry of value) {
    if (!isUnknownRecord(entry)) continue;

    const url =
      typeof entry.url === 'string' ? normalizeDisplayValue(entry.url, MAX_LINK_URL_LENGTH) : '';
    if (!url) continue;

    const next: UnknownRecord = { ...entry, url };
    if (typeof entry.title === 'string') {
      next.title = normalizeDisplayValue(entry.title, MAX_LINK_TITLE_LENGTH);
    }
    if (typeof entry.description === 'string') {
      next.description = normalizeDisplayValue(entry.description, MAX_LINK_DESCRIPTION_LENGTH);
    }
    normalized.push(next);
  }
  return normalized;
}

/**
 * Normalize `locations[]`: the place `name` / `label` and every string leaf of
 * the nested `address` (whose `formattedAddress` is Nominatim's raw
 * `display_name`). Coordinates, metadata and timestamps pass through untouched.
 *
 * Non-object entries are dropped; a non-array input is returned untouched.
 */
export function normalizeLocations(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const normalized: unknown[] = [];
  for (const entry of value) {
    if (!isUnknownRecord(entry)) continue;

    const next = withNormalizedKeys(entry, ['name', 'label'], MAX_LOCATION_TEXT_LENGTH);
    if (isUnknownRecord(next.address)) {
      next.address = withNormalizedKeys(
        next.address,
        LOCATION_ADDRESS_TEXT_KEYS,
        MAX_LOCATION_TEXT_LENGTH
      );
    }
    normalized.push(next);
  }
  return normalized;
}

/**
 * Normalize `links[]`: a plain array of profile URLs. A URL can never contain
 * whitespace, so each entry is inline-normalized and entries that normalize to
 * nothing (or are not strings) are dropped.
 *
 * A non-array input is returned untouched.
 */
export function normalizeLinks(value: unknown): unknown {
  if (!Array.isArray(value)) return value;

  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const url = normalizeDisplayValue(entry, MAX_LINK_URL_LENGTH);
    if (url) normalized.push(url);
  }
  return normalized;
}
