import { NextResponse, type NextRequest } from "next/server"

import {
    apiPost,
    getForwardHeaders,
    SESSION_COOKIE_NAME,
} from "@/lib/oxy-api"

type SessionAuthResponse = {
    sessionId: string
    expiresAt?: string
    accessToken?: string
}

const VALID_PROVIDERS = ["google", "apple", "github"] as const

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ provider: string }> }
) {
    const { provider } = await params

    if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
        return NextResponse.json(
            { message: "Invalid provider" },
            { status: 400 }
        )
    }

    let body: Record<string, unknown>
    try {
        body = await request.json()
    } catch {
        return NextResponse.json(
            { message: "Invalid request body" },
            { status: 400 }
        )
    }

    const { code, idToken } = body as { code?: string; idToken?: string }

    if (!code && !idToken) {
        return NextResponse.json(
            { message: "code or idToken is required" },
            { status: 400 }
        )
    }

    try {
        const payload: Record<string, string> = {}
        if (code) payload.code = String(code)
        if (idToken) payload.idToken = String(idToken)

        const session = await apiPost<SessionAuthResponse>(
            `/auth/social/${provider}`,
            payload,
            { headers: getForwardHeaders(request) }
        )

        const jsonResponse = NextResponse.json({
            sessionId: session.sessionId,
            expiresAt: session.expiresAt,
            accessToken: session.accessToken,
        })

        // Set httpOnly session cookie (same pattern as login route)
        const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined
        const expiresAt = session.expiresAt
            ? new Date(session.expiresAt)
            : undefined
        jsonResponse.cookies.set(SESSION_COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            secure: true,
            sameSite: "none",
            path: "/",
            ...(cookieDomain ? { domain: cookieDomain } : {}),
            ...(expiresAt ? { expires: expiresAt } : {}),
        })

        // Set FedCM login status
        jsonResponse.headers.set("Set-Login", "logged-in")

        return jsonResponse
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Social sign in failed"
        return NextResponse.json({ message }, { status: 400 })
    }
}
