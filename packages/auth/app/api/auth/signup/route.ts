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
        buildRelativeUrl("/signup", {
            ...params,
            error: message,
        }),
        request.url
    )
    return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
    const formData = await request.formData()
    const email = String(formData.get("email") || "").trim()
    const password = String(formData.get("password") || "")
    const username = String(formData.get("username") || "").trim()
    const sessionToken = String(formData.get("session_token") || "")
    const redirectUri = String(formData.get("redirect_uri") || "")
    const state = String(formData.get("state") || "")

    if (!email || !password || !username) {
        return redirectWithError(request, "Email, username, and password are required", {
            token: sessionToken,
            redirect_uri: redirectUri,
            state,
        })
    }

    try {
        const payload: Record<string, string> = { email, password, username }

        const session = await apiPost<SessionAuthResponse>(
            "/api/auth/signup",
            payload,
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
            error instanceof Error ? error.message : "Unable to sign up"
        return redirectWithError(request, message, {
            token: sessionToken,
            redirect_uri: redirectUri,
            state,
        })
    }
}
