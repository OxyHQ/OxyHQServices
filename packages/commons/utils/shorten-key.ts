/**
 * Shorten a long opaque value (public key, DID, credential issuer id) for
 * display as `head…tail`.
 *
 * The single key-shortening convention across Commons — always the `…` ellipsis,
 * never `...`. Values already short enough (would not save any characters) are
 * returned unchanged.
 *
 * @param value - the full value to shorten
 * @param head - leading characters to keep (default 8)
 * @param tail - trailing characters to keep (default 8)
 */
export function shortenKey(value: string, head = 8, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
