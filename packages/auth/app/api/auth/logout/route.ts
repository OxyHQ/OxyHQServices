import { NextResponse, type NextRequest } from "next/server"
import { cookies } from "next/headers"

import {
    apiDelete,
    getForwardHeaders,
    getPublicBaseUrl,
    SESSION_COOKIE_NAME,
} from "@/lib/oxy-api"

/**
 * Logout endpoint - invalidates ALL sessions for the user across all apps
 * Also sets FedCM login status to logged-out
 */
export async function POST(request: NextRequest) {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value

    if (!sessionId) {
        // No session to logout, but still clear FedCM status
        const response = NextResponse.json({ success: true, message: "No active session" })
        response.headers.set("Set-Login", "logged-out")
        return response
    }

    try {
        // Call API to logout ALL sessions for this user (Single Logout)
        await apiDelete(
            `/api/sessions/${sessionId}/all`,
            { headers: getForwardHeaders(request) }
        )
    } catch (error) {
        console.error("[Logout] Failed to invalidate sessions:", error)
        // Continue anyway - we still want to clear the local cookie
    }

    // Clear the session cookie
    const response = NextResponse.json({ success: true, message: "Logged out from all devices" })

    response.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0, // Expire immediately
    })

    // Set FedCM login status to logged-out
    // This tells browsers the user is no longer signed in at this IdP
    response.headers.set("Set-Login", "logged-out")

    return response
}

/**
 * GET handler for logout - supports redirect after logout
 */
export async function GET(request: NextRequest) {
    const cookieStore = await cookies()
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value
    const redirectUrl = request.nextUrl.searchParams.get("redirect") || "/"

    if (sessionId) {
        try {
            await apiDelete(
                `/api/sessions/${sessionId}/all`,
                { headers: getForwardHeaders(request) }
            )
        } catch (error) {
            console.error("[Logout] Failed to invalidate sessions:", error)
        }
    }

    // Redirect to login page or specified URL
    const response = NextResponse.redirect(
        new URL(redirectUrl, getPublicBaseUrl(request)),
        303
    )

    response.cookies.set(SESSION_COOKIE_NAME, "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    })

    response.headers.set("Set-Login", "logged-out")

    return response
}
