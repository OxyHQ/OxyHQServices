/**
 * Raw, pre-rehost link metadata produced by the resolver pipeline (provider
 * chain or generic Open Graph scrape).
 *
 * The image / favicon fields here are the RAW REMOTE (origin) URLs. They are
 * NEVER returned to clients — the link-preview service downloads them
 * server-side and re-hosts them onto Oxy media before serializing. Keeping the
 * resolver output raw (and the re-host a separate step) is what enforces the
 * privacy invariant: no origin media URL ever reaches a client.
 */
export interface RawLinkMetadata {
  /** Canonical / final URL after following redirects. */
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  /** Raw remote (origin) image URL — re-hosted before reaching a client. */
  imageUrl?: string;
  /** Raw remote (origin) favicon URL — re-hosted before reaching a client. */
  faviconUrl?: string;
}
