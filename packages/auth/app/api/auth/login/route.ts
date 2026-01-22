import { NextResponse, type NextRequest } from "next/server"

import {
    apiPost,
    buildRelativeUrl,
    getForwardHeaders,
    getPublicBaseUrl,
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
        getPublicBaseUrl(request)
    )
    return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
    const contentType = request.headers.get("content-type") || ""
    const isJson = contentType.includes("application/json")

    let identifier: string
    let password: string
    let sessionToken = ""
    let redirectUri = ""
    let state = ""

    if (isJson) {
        const body = await request.json()
        identifier = String(body.identifier || "").trim()
        password = String(body.password || "")
    } else {
        const formData = await request.formData()
        identifier = String(formData.get("identifier") || "").trim()
        password = String(formData.get("password") || "")
        sessionToken = String(formData.get("session_token") || "")
        redirectUri = String(formData.get("redirect_uri") || "")
        state = String(formData.get("state") || "")
    }

    if (!identifier || !password) {
        if (isJson) {
            return NextResponse.json(
                { message: "Email and password are required" },
                { status: 400 }
            )
        }
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

        if (isJson) {
            return NextResponse.json({
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
            })
        }

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
                getPublicBaseUrl(request)
            ),
            303
        )

        const expiresAt = session.expiresAt ? new Date(session.expiresAt) : undefined
        response.cookies.set(SESSION_COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            secure: true, // Required for sameSite: none
            sameSite: "none", // Allow cross-site for SSO iframe auth
            path: "/",
            ...(expiresAt ? { expires: expiresAt } : {}),
        })

        return response
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to sign in"
        if (isJson) {
            return NextResponse.json({ message }, { status: 400 })
        }
        return redirectWithError(request, message, {
            token: sessionToken,
            redirect_uri: redirectUri,
            state,
        })
    }
}
