import type { NextRequest } from "next/server"

const DEFAULT_API_URL = "https://api.oxy.so"
const LOCAL_API_URL = "http://localhost:3001"

export const SESSION_COOKIE_NAME = "oxy_session_id"
export const RECOVERY_COOKIE_NAME = "oxy_recovery_token"

export function getApiBaseUrl(): string {
    const envUrl =
        process.env.OXY_API_URL || process.env.NEXT_PUBLIC_OXY_API_URL
    if (envUrl) {
        return envUrl
    }

    if (process.env.NODE_ENV !== "production") {
        return LOCAL_API_URL
    }

    return DEFAULT_API_URL
}

export function buildRelativeUrl(
    pathname: string,
    params: Record<string, string | undefined>
): string {
    const url = new URL(pathname, "http://localhost")
    for (const [key, value] of Object.entries(params)) {
        if (value) {
            url.searchParams.set(key, value)
        }
    }
    return `${url.pathname}${url.search}`
}

/**
 * Get the public base URL for redirects.
 * Handles proxy scenarios where request.url shows internal URL.
 */
export function getPublicBaseUrl(request: NextRequest): string {
    // Check for forwarded host (from load balancers/proxies)
    const forwardedHost = request.headers.get("x-forwarded-host")
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https"

    if (forwardedHost) {
        return `${forwardedProto}://${forwardedHost}`
    }

    // Check for host header
    const host = request.headers.get("host")
    if (host && !host.includes("localhost")) {
        const proto = host.includes("localhost") ? "http" : "https"
        return `${proto}://${host}`
    }

    // Fall back to request.url
    const url = new URL(request.url)
    return url.origin
}

export function safeRedirectUrl(value?: string | null): string | null {
    if (!value) {
        return null
    }

    try {
        const parsed = new URL(value)

        // Block dangerous protocols
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return null
        }

        // In production, require HTTPS (except localhost for dev tools)
        if (
            process.env.NODE_ENV === "production" &&
            parsed.protocol === "http:" &&
            parsed.hostname !== "localhost" &&
            parsed.hostname !== "127.0.0.1"
        ) {
            return null
        }

        // Block IP-address hostnames (common phishing vector)
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname)) {
            return null
        }

        return parsed.toString()
    } catch {
        return null
    }
}

export function getForwardHeaders(request: NextRequest): Record<string, string> {
    const headers: Record<string, string> = {}
    const forward = [
        "user-agent",
        "accept-language",
        "sec-ch-ua",
        "sec-ch-ua-platform",
        "sec-ch-ua-mobile",
        "x-forwarded-for",
        "x-real-ip",
    ]

    for (const name of forward) {
        const value = request.headers.get(name)
        if (value) {
            headers[name] = value
        }
    }

    return headers
}

type ApiPayload = Record<string, unknown> | string | null

function unwrapResponse(payload: ApiPayload): ApiPayload {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return payload
    }

    if ("data" in payload) {
        return (payload as Record<string, unknown>).data as ApiPayload
    }

    return payload
}

function getErrorMessage(payload: ApiPayload, fallback: string): string {
    if (payload && typeof payload === "object" && "message" in payload) {
        const message = (payload as Record<string, unknown>).message
        if (typeof message === "string") {
            return message
        }
    }
    return fallback
}

export async function apiRequest<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${getApiBaseUrl()}${path}`, {
        cache: "no-store",
        ...init,
    })

    const text = await response.text()
    let payload: ApiPayload = null
    if (text) {
        try {
            payload = JSON.parse(text)
        } catch {
            payload = text
        }
    }

    if (!response.ok) {
        throw new Error(getErrorMessage(payload, response.statusText || "Request failed"))
    }

    return unwrapResponse(payload) as T
}

export async function apiPost<T>(
    path: string,
    body: unknown,
    init?: RequestInit
): Promise<T> {
    const headers = new Headers(init?.headers)
    if (!headers.has("content-type")) {
        headers.set("content-type", "application/json")
    }

    return apiRequest<T>(path, {
        ...init,
        method: "POST",
        headers,
        body: JSON.stringify(body),
    })
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
    return apiRequest<T>(path, {
        ...init,
        method: "GET",
    })
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
    return apiRequest<T>(path, {
        ...init,
        method: "DELETE",
    })
}
