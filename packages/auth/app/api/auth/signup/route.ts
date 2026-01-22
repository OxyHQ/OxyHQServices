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
        buildRelativeUrl("/signup", {
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

    let email: string
    let password: string
    let username: string
    let sessionToken = ""
    let redirectUri = ""
    let state = ""

    if (isJson) {
        const body = await request.json()
        email = String(body.email || "").trim()
        password = String(body.password || "")
        username = String(body.username || "").trim()
    } else {
        const formData = await request.formData()
        email = String(formData.get("email") || "").trim()
        password = String(formData.get("password") || "")
        username = String(formData.get("username") || "").trim()
        sessionToken = String(formData.get("session_token") || "")
        redirectUri = String(formData.get("redirect_uri") || "")
        state = String(formData.get("state") || "")
    }

    if (!email || !password || !username) {
        if (isJson) {
            return NextResponse.json(
                { message: "Email, username, and password are required" },
                { status: 400 }
            )
        }
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
        // Get the domain for cookie sharing across oxy.so subdomains
        const host = request.headers.get("host") || ""
        const cookieDomain = host.endsWith(".oxy.so") || host === "oxy.so" ? ".oxy.so" : undefined
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
            error instanceof Error ? error.message : "Unable to sign up"
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
