import { buildApiUrl } from "@/lib/oxy-api-client"
import { refreshResponseSchema, safeParse } from "@/lib/schemas"

export type MintedAccessToken = {
    accessToken: string
    sessionId: string
    expiresAt?: string
}

export function readSessionIdFromAccessToken(accessToken: string): string | null {
    try {
        const segments = accessToken.split(".")
        if (segments.length !== 3) return null
        const payloadSegment = segments[1].replace(/-/g, "+").replace(/_/g, "/")
        const padded = payloadSegment.padEnd(
            payloadSegment.length + ((4 - (payloadSegment.length % 4)) % 4),
            "="
        )
        const json = JSON.parse(atob(padded)) as { sessionId?: unknown }
        return typeof json.sessionId === "string" && json.sessionId.length > 0
            ? json.sessionId
            : null
    } catch {
        return null
    }
}

export async function mintAccessTokenFromRefreshCookie(
    authuser?: number
): Promise<MintedAccessToken | null> {
    const url = new URL(buildApiUrl("/auth/refresh"))
    if (typeof authuser === "number") {
        url.searchParams.set("authuser", String(authuser))
    }

    const response = await fetch(url.toString(), {
        method: "POST",
        credentials: "include",
        headers: { Accept: "application/json" },
    })

    if (!response.ok) return null

    const parsed = safeParse(
        refreshResponseSchema,
        await response.json().catch(() => null)
    )
    if (!parsed?.accessToken) return null

    const sessionId = readSessionIdFromAccessToken(parsed.accessToken)
    if (!sessionId) return null

    return {
        accessToken: parsed.accessToken,
        sessionId,
        expiresAt: parsed.expiresAt,
    }
}
