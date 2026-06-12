/**
 * Stable per-browser device fingerprint for the auth IdP.
 *
 * The fingerprint is a SHA-256 hex digest of:
 *   `${navigator.userAgent}|${navigator.language}|${screen.width}x${screen.height}|${timeZone}`
 *
 * It is NOT a secret — it's a stable identifier the server uses to dedupe
 * device-local refresh-cookie slots (Google-style multi-account): a second
 * sign-in from the SAME device fingerprint reuses an existing `oxy_rt_${n}`
 * slot rather than spawning a new one. Persisted in `localStorage` under
 * `oxy_device_fingerprint` so subsequent visits send the same value.
 *
 * Security properties:
 *   - SHA-256 makes the raw inputs unrecoverable.
 *   - Stable across reloads (same browser, same device) but DIFFERENT across
 *     different browsers / devices / private windows — exactly the property
 *     needed for slot deduplication.
 *   - Computed via Web Crypto API (`crypto.subtle.digest`) — no external
 *     dependencies, no random bytes; the hash is deterministic.
 *
 * Returns `""` (empty string) on SSR / non-browser / Web Crypto missing —
 * callers must tolerate this (the server treats a missing fingerprint as
 * "no dedupe hint" / anonymous device — the legacy single-slot behavior —
 * and allocates a fresh slot).
 *
 * @module lib/device-fingerprint
 */

const STORAGE_KEY = "oxy_device_fingerprint"

function hasBrowserGlobals(): boolean {
    return (
        typeof window !== "undefined" &&
        typeof navigator !== "undefined" &&
        typeof screen !== "undefined" &&
        typeof window.localStorage !== "undefined" &&
        typeof window.crypto !== "undefined" &&
        typeof window.crypto.subtle !== "undefined"
    )
}

function readPersistedFingerprint(): string | null {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        // Validate the persisted value to defend against tampering: 64 hex
        // chars exactly (sha-256 hex digest). Anything else is treated as
        // corrupt and recomputed.
        if (raw && /^[0-9a-f]{64}$/.test(raw)) {
            return raw
        }
        return null
    } catch {
        return null
    }
}

function writePersistedFingerprint(value: string): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, value)
    } catch {
        // Quota / private-mode failures are non-fatal — the next call just
        // recomputes the same hash from the same inputs.
    }
}

function buildFingerprintInput(): string {
    const ua = navigator.userAgent ?? ""
    const lang = navigator.language ?? ""
    const dims = `${screen.width}x${screen.height}`
    let timeZone = ""
    try {
        timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? ""
    } catch {
        // Intl might be partially unavailable; an empty time zone is fine —
        // the rest of the inputs still produce a stable hash.
    }
    return `${ua}|${lang}|${dims}|${timeZone}`
}

async function sha256Hex(input: string): Promise<string> {
    const bytes = new TextEncoder().encode(input)
    const digest = await window.crypto.subtle.digest("SHA-256", bytes)
    const view = new Uint8Array(digest)
    let hex = ""
    for (let i = 0; i < view.length; i++) {
        hex += view[i].toString(16).padStart(2, "0")
    }
    return hex
}

/**
 * Get the device fingerprint, computing it on first use and caching in
 * `localStorage`. Returns `""` (empty string) when running on the server /
 * in a context without Web Crypto — callers must treat the fingerprint as
 * optional and an empty value as "no dedupe hint" / anonymous device.
 * Never throws.
 */
export async function getOrCreateDeviceFingerprint(): Promise<string> {
    if (!hasBrowserGlobals()) return ""

    const cached = readPersistedFingerprint()
    if (cached) return cached

    try {
        const hash = await sha256Hex(buildFingerprintInput())
        writePersistedFingerprint(hash)
        return hash
    } catch {
        return ""
    }
}
