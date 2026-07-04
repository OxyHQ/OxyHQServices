type PostLoginRedirectParams = {
    sessionToken?: string
    redirectUri?: string
    state?: string
    clientId?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    scope?: string
    authuser?: number
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
    clientId,
    codeChallenge,
    codeChallengeMethod,
    scope,
    authuser,
}: PostLoginRedirectParams): string {
    const nextUrl = new URL("/authorize", window.location.origin)
    if (sessionToken) nextUrl.searchParams.set("token", sessionToken)
    if (redirectUri) nextUrl.searchParams.set("redirect_uri", redirectUri)
    if (state) nextUrl.searchParams.set("state", state)
    if (clientId) nextUrl.searchParams.set("client_id", clientId)
    if (codeChallenge) nextUrl.searchParams.set("code_challenge", codeChallenge)
    if (codeChallengeMethod) nextUrl.searchParams.set("code_challenge_method", codeChallengeMethod)
    if (scope) nextUrl.searchParams.set("scope", scope)
    if (typeof authuser === "number") nextUrl.searchParams.set("authuser", String(authuser))
    if (!sessionToken && !redirectUri && !clientId) {
        nextUrl.searchParams.set(
            "error",
            "No authorization request found. Return to the app and try again."
        )
    }
    return `${nextUrl.pathname}${nextUrl.search}`
}
