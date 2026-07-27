/**
 * Renders the web origin a sign-in request is bound to as the bare host the
 * approver recognizes — `https://mention.earth` -> `mention.earth`.
 *
 * The value always comes from the server-resolved approval info, never from the
 * QR/deep link, but it is still displayed as evidence of WHO is asking, so it is
 * parsed strictly rather than string-trimmed: only a plain `scheme://host[:port]`
 * origin is accepted. Anything carrying credentials, a path, a query or a
 * fragment (`https://mention.earth@evil.example/…`, the classic look-alike) is
 * rejected whole and nothing is shown — a blank line is safe, a misleading one
 * is not.
 *
 * Pure + dependency-free (no `URL`, which differs between Hermes and the web),
 * so it unit-tests directly.
 */

/** `scheme://host[:port]` and nothing else. Host labels are letters/digits/`-`/`.`. */
const BARE_ORIGIN = /^([a-z][a-z0-9+.-]*):\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)(?::(\d{1,5}))?$/i;

/**
 * @param boundOrigin - The `boundOrigin` field of the server-resolved approval info.
 * @returns The host (with port when non-default) to display, or `null` when the
 *          request has no origin or the value is not a plain origin.
 */
export function formatRequestOrigin(boundOrigin: string | undefined | null): string | null {
  if (typeof boundOrigin !== 'string') return null;

  const value = boundOrigin.trim().replace(/\/+$/, '');
  if (!value) return null;

  const match = BARE_ORIGIN.exec(value);
  const host = match?.[2];
  if (!host) return null;

  const port = match?.[3];
  return port ? `${host}:${port}` : host;
}
