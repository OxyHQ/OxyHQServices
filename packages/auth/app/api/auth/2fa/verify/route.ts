import { NextResponse, type NextRequest } from "next/server"

import {
    apiPost,
    getForwardHeaders,
    SESSION_COOKIE_NAME,
} from "@/lib/oxy-api"

type TwoFactorLoginResponse = {
    sessionId: string
    deviceId: string
    expiresAt: string
    accessToken?: string
    user: {
        id: string
        username?: string
        avatar?: string
    }
}

export async function POST(request: NextRequest) {
    const body = await request.json()
    const { loginToken, token, backupCode } = body

    if (!loginToken) {
        return NextResponse.json(
            { message: "Login token is required" },
            { status: 400 }
        )
    }

    if (!token && !backupCode) {
        return NextResponse.json(
            { message: "Token or backup code is required" },
            { status: 400 }
        )
    }

    try {
        const session = await apiPost<TwoFactorLoginResponse>(
            "/security/2fa/verify-login",
            { loginToken, token, backupCode },
            { headers: getForwardHeaders(request) }
        )

        const jsonResponse = NextResponse.json({
            sessionId: session.sessionId,
            expiresAt: session.expiresAt,
            accessToken: session.accessToken,
        })

        // Set httpOnly session cookie (same as login route)
        const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined
        const expiresAt = session.expiresAt ? new Date(session.expiresAt) : undefined
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
            error instanceof Error ? error.message : "Unable to verify"
        return NextResponse.json({ message }, { status: 400 })
    }
}
