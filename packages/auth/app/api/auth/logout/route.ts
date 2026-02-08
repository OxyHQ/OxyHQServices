import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"

import {
    apiPost,
    getForwardHeaders,
    getPublicBaseUrl,
    SESSION_COOKIE_NAME,
} from "@/lib/oxy-api"

const cookieDomain = process.env.AUTH_COOKIE_DOMAIN || undefined

function clearSessionCookie(response: NextResponse) {
    response.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
        ...(cookieDomain ? { domain: cookieDomain } : {}),
        maxAge: 0,
    })
}

/**
 * Logout endpoint - invalidates ALL sessions for the user across all apps.
 * Sets FedCM login status to logged-out.
 */
export async function POST(request: NextRequest) {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value

    if (!sessionId) {
        const response = NextResponse.json({ success: true, message: "No active session" })
        response.headers.set("Set-Login", "logged-out")
        return response
    }

    try {
        await apiPost(
            `/session/logout-all/${sessionId}`,
            {},
            { headers: getForwardHeaders(request) }
        )
    } catch (error) {
        console.error("[Logout] Failed to invalidate sessions:", error)
    }

    const response = NextResponse.json({ success: true, message: "Logged out from all devices" })
    clearSessionCookie(response)
    response.headers.set("Set-Login", "logged-out")

    return response
}

/**
 * GET handler for logout - supports redirect after logout.
 * Only allows relative path redirects to prevent open redirect attacks.
 */
export async function GET(request: NextRequest) {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value
    const rawRedirect = request.nextUrl.searchParams.get("redirect") || "/"
    const redirectUrl = rawRedirect.startsWith("/") && !rawRedirect.startsWith("//") ? rawRedirect : "/"

    if (sessionId) {
        try {
            await apiPost(
                `/session/logout-all/${sessionId}`,
                {},
                { headers: getForwardHeaders(request) }
            )
        } catch (error) {
            console.error("[Logout] Failed to invalidate sessions:", error)
        }
    }

    const response = NextResponse.redirect(
        new URL(redirectUrl, getPublicBaseUrl(request)),
        303
    )
    clearSessionCookie(response)
    response.headers.set("Set-Login", "logged-out")

    return response
}
