/**
 * Register the session with the FedCM server so it can set the httpOnly
 * `fedcm_session` cookie the browser needs for FedCM account lookups.
 *
 * Returns a promise that resolves once the `/fedcm/set-session` request
 * settles. Callers that must guarantee the cookie is in place before the next
 * FedCM step (e.g. `IdentityProvider.close()` re-running the accounts flow)
 * should AWAIT this. Failures resolve (never reject) — FedCM is an enhancement,
 * not the critical path.
 */
export async function registerFedCMSession(sessionId: string): Promise<void> {
    try {
        await fetch("/fedcm/set-session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ sessionId, action: "login" }),
        })
    } catch {
        // Best-effort — FedCM is an enhancement, not critical path
    }
}

/**
 * Register a session with the FedCM server and set the browser's FedCM Login Status.
 * Best-effort — failures are silently ignored.
 */
export function setFedCMLoginStatus(sessionId: string): void {
    // Register the session with the FedCM server (fire-and-forget here; the
    // FedCM login_url completion path awaits `registerFedCMSession` directly).
    void registerFedCMSession(sessionId)

    // Also load the login-status endpoint in an iframe to set
    // the Set-Login header for the browser's FedCM Login Status API
    const loginStatusFrame = document.createElement("iframe")
    loginStatusFrame.style.display = "none"
    loginStatusFrame.src = "/fedcm/login-status"
    document.body.appendChild(loginStatusFrame)
    setTimeout(() => loginStatusFrame.remove(), 1000)
}

/**
 * Minimal structural shape of the W3C FedCM `IdentityProvider` interface object,
 * modelling only the static `close()` method we invoke. `IdentityProvider` is
 * not declared in the TypeScript lib.dom we build against, so we read it off
 * `window` through this structural type (never `any`).
 *
 * @see https://w3c-fedid.github.io/FedCM/#browser-api-identity-provider-interface
 */
interface FedCMIdentityProviderStatic {
    close(): void
}

/**
 * Signal completion of a FedCM "login_url" sign-in.
 *
 * When the browser's FedCM flow finds no signed-in account, it opens the IdP's
 * `login_url` (here `/login`, per `public/fedcm.json`) in a browser dialog so the
 * user can authenticate. That dialog carries NO OAuth params. After a successful
 * login + `setFedCMLoginStatus()` (which sets the IdP session cookie and the
 * `Set-Login: logged-in` signal), the page MUST call `IdentityProvider.close()`
 * to dismiss the dialog. Chrome then re-runs the accounts flow — which now
 * resolves the freshly-set account — and completes credential issuance to the
 * relying party.
 *
 * Without this call the page would instead navigate to `/authorize` with no
 * request context and render "No authorization request" inside the FedCM dialog.
 *
 * @returns `true` if this was a FedCM login_url context and completion was
 * signalled (caller must NOT navigate); `false` if it was an ordinary login
 * and the caller should perform its normal post-login redirect.
 */
export function completeFedCMLogin(): boolean {
    if (typeof window === "undefined") return false

    const identityProvider = (window as unknown as {
        IdentityProvider?: Partial<FedCMIdentityProviderStatic>
    }).IdentityProvider

    if (identityProvider && typeof identityProvider.close === "function") {
        try {
            // Closes the FedCM dialog and prompts Chrome to re-evaluate the
            // accounts endpoint, which now succeeds with the new session.
            identityProvider.close()
            return true
        } catch {
            return false
        }
    }

    return false
}

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
