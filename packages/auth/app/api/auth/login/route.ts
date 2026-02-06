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
    accessToken?: string
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
            const jsonResponse = NextResponse.json({
                sessionId: session.sessionId,
                expiresAt: session.expiresAt,
                accessToken: session.accessToken,
            })
            // Set FedCM login status for API responses too
            jsonResponse.headers.set("Set-Login", "logged-in")
            return jsonResponse
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

        // Set FedCM login status - tells browser user is logged in at this IdP
        // This is required for FedCM silent mediation to work
        response.headers.set("Set-Login", "logged-in")

        const expiresAt = session.expiresAt ? new Date(session.expiresAt) : undefined
        // Cookie domain from env var (not from user-controlled Host header)
        const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined
        response.cookies.set(SESSION_COOKIE_NAME, session.sessionId, {
            httpOnly: true,
            secure: true, // Required for sameSite: none
            sameSite: "none", // Allow cross-site for SSO iframe auth
            path: "/",
            ...(cookieDomain ? { domain: cookieDomain } : {}),
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
