import { buildApiUrl } from "@/lib/oxy-api-client"

let cachedCsrfToken: string | null = null
let csrfTokenPromise: Promise<string | null> | null = null

async function fetchCsrfToken(): Promise<string | null> {
    if (cachedCsrfToken) return cachedCsrfToken
    if (csrfTokenPromise) return csrfTokenPromise

    csrfTokenPromise = (async () => {
        const response = await fetch(buildApiUrl("/csrf-token"), {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
        })

        if (!response.ok) return null

        const payload = await response.json().catch(() => ({}))
        const token = typeof payload?.csrfToken === "string"
            ? payload.csrfToken
            : response.headers.get("X-CSRF-Token")

        cachedCsrfToken = token || null
        return cachedCsrfToken
    })().finally(() => {
        csrfTokenPromise = null
    })

    return csrfTokenPromise
}

export async function withCsrfHeader(headers: HeadersInit = {}): Promise<Headers> {
    const nextHeaders = new Headers(headers)
    const csrfToken = await fetchCsrfToken()

    if (csrfToken) {
        nextHeaders.set("X-CSRF-Token", csrfToken)
    }

    return nextHeaders
}

export function clearCachedCsrfToken(): void {
    cachedCsrfToken = null
}
