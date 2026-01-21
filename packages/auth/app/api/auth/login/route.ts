import { NextResponse, type NextRequest } from "next/server"

import {
    apiPost,
    buildRelativeUrl,
    getForwardHeaders,
    SESSION_COOKIE_NAME,
} from "@/lib/oxy-api"

type SessionAuthResponse = {
    sessionId: string
    expiresAt?: string
}

function redirectWithError(
    request: NextRequest,
    message: string,
    params: Record<string, string | undefined>
) {
    const url = new URL(
        buildRelativeUrl("/login", {
            ...params,
            error: message,
        }),
        request.url
    )
    return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
    const formData = await request.formData()
    const identifier = String(formData.get("identifier") || "").trim()
    const password = String(formData.get("password") || "")
    const sessionToken = String(formData.get("session_token") || "")
    const redirectUri = String(formData.get("redirect_uri") || "")
    const state = String(formData.get("state") || "")

    if (!identifier || !password) {
        return redirectWithError(request, "Email and password are required", {
            token: sessionToken,
            redirect_uri: redirectUri,
            state,
        })
    }

    try {
        const session = await apiPost<SessionAuthResponse>(
            "/api/auth/login",
            { identifier, password },
            { headers: getForwardHeaders(request) }
        )

        const response = NextResponse.redirect(
            new URL(
                buildRelativeUrl(
                    sessionToken || redirectUri ? "/authorize" : "/",
                    {
                        token: sessionToken || undefined,
                        redirect_uri: redirectUri || undefined,
                        state: state || undefined,
                    }
                ),
                request.url
            ),
            303
        )

        const expiresAt = session.expiresAt ? new Date(session.expiresAt) : undefined
        response.cookies.set(SESSION_COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: "/",
            ...(expiresAt ? { expires: expiresAt } : {}),
        })

        return response
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to sign in"
        return redirectWithError(request, message, {
            token: sessionToken,
            redirect_uri: redirectUri,
            state,
        })
    }
}
