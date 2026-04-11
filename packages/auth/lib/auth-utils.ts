/**
 * Register a session with the FedCM server and set the browser's FedCM Login Status.
 * Best-effort — failures are silently ignored.
 */
export function setFedCMLoginStatus(sessionId: string): void {
    // Register the session with the FedCM server so it can set
    // the httpOnly cookie the browser needs for FedCM account lookups
    fetch("/fedcm/set-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ sessionId, action: "login" }),
    }).catch(() => {
        // Best-effort — FedCM is an enhancement, not critical path
    })

    // Also load the login-status endpoint in an iframe to set
    // the Set-Login header for the browser's FedCM Login Status API
    const loginStatusFrame = document.createElement("iframe")
    loginStatusFrame.style.display = "none"
    loginStatusFrame.src = "/fedcm/login-status"
    document.body.appendChild(loginStatusFrame)
    setTimeout(() => loginStatusFrame.remove(), 1000)
}

type PostLoginRedirectParams = {
    sessionToken?: string
    redirectUri?: string
    state?: string
}

/**
 * Build the URL path for redirecting after a successful login/signup.
 * Navigates to /authorize with the appropriate query params, or sets an
 * error if no authorization request context was provided.
 */
export function buildPostLoginRedirect({
    sessionToken,
    redirectUri,
    state,
}: PostLoginRedirectParams): string {
    const nextUrl = new URL("/authorize", window.location.origin)
    if (sessionToken) nextUrl.searchParams.set("token", sessionToken)
    if (redirectUri) nextUrl.searchParams.set("redirect_uri", redirectUri)
    if (state) nextUrl.searchParams.set("state", state)
    if (!sessionToken && !redirectUri) {
        nextUrl.searchParams.set(
            "error",
            "No authorization request found. Return to the app and try again."
        )
    }
    return `${nextUrl.pathname}${nextUrl.search}`
}
