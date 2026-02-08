import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { apiGet, SESSION_COOKIE_NAME } from "@/lib/oxy-api"

/**
 * Lightweight session check endpoint for cross-domain SSO validation
 *
 * Returns an HTML page that posts a message to the parent window
 * indicating whether the user has a valid session at the IdP.
 *
 * Validates the session against the backend API to ensure it hasn't
 * been revoked or expired (not just cookie existence).
 *
 * Usage: Load in a hidden iframe, listen for postMessage
 */
export async function GET() {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)

    let hasSession = false
    if (sessionCookie?.value) {
        try {
            await apiGet(`/session/validate/${sessionCookie.value}`)
            hasSession = true
        } catch {
            hasSession = false
        }
    }

    // Return minimal HTML that posts message to parent
    const html = `<!DOCTYPE html>
<html><head><script>
window.parent.postMessage({type:'oxy-session-check',hasSession:${hasSession}},'*');
</script></head><body></body></html>`

    return new NextResponse(html, {
        headers: {
            "Content-Type": "text/html",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            // Set login status header for FedCM
            "Set-Login": hasSession ? "logged-in" : "logged-out",
        },
    })
}
