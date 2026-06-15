/**
 * Friendly, human-readable labels for OAuth scopes shown on the consent screen.
 *
 * The consent UI must never present a raw scope string (e.g. `files:write`) to
 * the user. Every scope the platform issues maps to a plain-language sentence
 * describing exactly what access the requesting application is asking for.
 */
export const SCOPE_LABELS: Record<string, string> = {
  "user:read": "Read your basic profile",
  "files:read": "Read your files",
  "files:write": "Upload and modify your files",
  "files:delete": "Delete your files",
  "webhooks:receive": "Receive webhooks",
  "chat:completions": "Use AI chat on your behalf",
  "models:read": "List available AI models",
  "federation:write": "Act across federated services",
};

/**
 * Resolve a single scope to its friendly label. Unknown scopes fall back to the
 * raw scope string so the user always sees *something* concrete rather than an
 * empty row — but registered scopes always render their curated sentence.
 */
export function labelForScope(scope: string): string {
  return SCOPE_LABELS[scope] ?? scope;
}
