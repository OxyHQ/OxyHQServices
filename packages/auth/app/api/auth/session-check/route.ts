import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { SESSION_COOKIE_NAME } from "@/lib/oxy-api"

/**
 * Lightweight session check endpoint for cross-domain SSO validation
 *
 * Returns an HTML page that posts a message to the parent window
 * indicating whether the user has a valid session at the IdP.
 *
 * Usage: Load in a hidden iframe, listen for postMessage
 */
export async function GET() {
    const cookieStore = await cookies()
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)
    const hasSession = !!sessionCookie?.value

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
