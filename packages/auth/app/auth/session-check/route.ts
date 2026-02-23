import { NextRequest, NextResponse } from "next/server"
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
 * Requires client_id query param (valid HTTP(S) origin) to restrict
 * postMessage target — prevents arbitrary sites from probing login status.
 *
 * Usage: Load in a hidden iframe, listen for postMessage
 */
export async function GET(request: NextRequest) {
    const clientId = request.nextUrl.searchParams.get("client_id")

    // Validate client_id is a valid HTTP(S) origin
    let clientOrigin: string
    if (!clientId) {
        return new NextResponse("client_id parameter is required", { status: 400 })
    }
    try {
        const parsed = new URL(clientId)
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return new NextResponse("client_id must be a valid HTTP(S) origin", { status: 400 })
        }
        clientOrigin = parsed.origin
    } catch {
        return new NextResponse("client_id must be a valid URL origin", { status: 400 })
    }

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

    // Safely encode as base64 to prevent script injection
    const payloadJson = JSON.stringify({
        type: "oxy-session-check",
        hasSession,
        targetOrigin: clientOrigin,
    })
    const payloadBase64 = Buffer.from(payloadJson).toString("base64")

    // Return minimal HTML that posts message to validated parent origin
    const html = `<!DOCTYPE html>
<html><head><script>
var p=JSON.parse(atob("${payloadBase64}"));
window.parent.postMessage({type:p.type,hasSession:p.hasSession},p.targetOrigin);
</script></head><body></body></html>`

    return new NextResponse(html, {
        headers: {
            "Content-Type": "text/html",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            // Set login status header for FedCM
            "Set-Login": hasSession ? "logged-in" : "logged-out",
            // Restrict iframe embedding to validated client origin
            "Content-Security-Policy": `frame-ancestors ${clientOrigin}`,
        },
    })
}
