import { useEffect, useState } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { useOxy } from "@oxyhq/services"
import type { SessionLoginResponse } from "@oxyhq/core"
import { loginResultSchema, safeParseContract } from "@oxyhq/contracts"
import { buildAuthUrl } from "@/lib/oxy-api-client"
import { buildPostLoginRedirect } from "@/lib/auth-utils"
import { LoadingSpinner } from "@/components/auth-form-layout"

type OAuthState = {
    provider: string
    sessionToken?: string
    redirectUri?: string
    state?: string
    clientId?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    scope?: string
}

function parseOAuthState(raw: string | null): OAuthState | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(atob(raw))
        if (typeof parsed?.provider !== "string") return null
        return {
            provider: parsed.provider,
            sessionToken: typeof parsed.sessionToken === "string" ? parsed.sessionToken : undefined,
            redirectUri: typeof parsed.redirectUri === "string" ? parsed.redirectUri : undefined,
            state: typeof parsed.state === "string" ? parsed.state : undefined,
            clientId: typeof parsed.clientId === "string" ? parsed.clientId : undefined,
            codeChallenge: typeof parsed.codeChallenge === "string" ? parsed.codeChallenge : undefined,
            codeChallengeMethod: typeof parsed.codeChallengeMethod === "string" ? parsed.codeChallengeMethod : undefined,
            scope: typeof parsed.scope === "string" ? parsed.scope : undefined,
        }
    } catch {
        return null
    }
}

export function SocialCallbackPage() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    // Social sign-in commits through the SAME device-first SDK funnel every Oxy
    // app uses (`handleWebSession`): token planted, `{deviceId, deviceSecret}`
    // persisted, account registered as active — so `/authorize` targets it.
    const { handleWebSession } = useOxy()
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        const controller = new AbortController()

        async function handleCallback() {
            const code = searchParams.get("code")
            const rawState = searchParams.get("state")
            const urlError = searchParams.get("error")

            if (urlError) {
                redirectToLogin(searchParams.get("error_description") || urlError, rawState)
                return
            }

            if (!code) {
                redirectToLogin("No authorization code received", rawState)
                return
            }

            const oauthState = parseOAuthState(rawState)
            if (!oauthState) {
                redirectToLogin("Invalid OAuth state", rawState)
                return
            }

            try {
                const response = await fetch(
                    buildAuthUrl(`/social/${oauthState.provider}`),
                    {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        credentials: "include",
                        body: JSON.stringify({ code }),
                        signal: controller.signal,
                    }
                )

                const payload = await response.json().catch(() => ({}))

                if (controller.signal.aborted) return

                // The social endpoint returns the same session arm the login
                // endpoint does — validate it and commit device-first.
                const parsed = response.ok ? safeParseContract(loginResultSchema, payload) : null
                if (!parsed || "twoFactorRequired" in parsed || !parsed.accessToken) {
                    const message = typeof payload?.message === "string"
                        ? payload.message
                        : "Social sign in failed"
                    redirectToLogin(message, rawState)
                    return
                }

                const session: SessionLoginResponse & { deviceSecret?: string } = {
                    sessionId: parsed.sessionId,
                    deviceId: parsed.deviceId,
                    expiresAt: parsed.expiresAt,
                    accessToken: parsed.accessToken,
                    // `name` is a throwaway placeholder — `handleWebSession`
                    // hydrates the full user profile right after committing.
                    user: {
                        id: parsed.user.id,
                        username: parsed.user.username ?? "",
                        name: {},
                        avatar: parsed.user.avatar,
                    },
                    ...(parsed.deviceSecret ? { deviceSecret: parsed.deviceSecret } : {}),
                }
                await handleWebSession(session)

                if (controller.signal.aborted) return

                navigate(buildPostLoginRedirect({
                    sessionToken: oauthState.sessionToken,
                    redirectUri: oauthState.redirectUri,
                    state: oauthState.state,
                    clientId: oauthState.clientId,
                    codeChallenge: oauthState.codeChallenge,
                    codeChallengeMethod: oauthState.codeChallengeMethod,
                    scope: oauthState.scope,
                }))
            } catch (err) {
                if (controller.signal.aborted) return
                redirectToLogin("Social sign in failed", rawState)
            }
        }

        function redirectToLogin(message: string, rawState: string | null) {
            setError(message)
            const loginUrl = new URL("/login", window.location.origin)
            loginUrl.searchParams.set("error", message)

            const oauthState = parseOAuthState(rawState)
            if (oauthState?.sessionToken) loginUrl.searchParams.set("token", oauthState.sessionToken)
            if (oauthState?.redirectUri) loginUrl.searchParams.set("redirect_uri", oauthState.redirectUri)
            if (oauthState?.state) loginUrl.searchParams.set("state", oauthState.state)
            if (oauthState?.clientId) loginUrl.searchParams.set("client_id", oauthState.clientId)
            if (oauthState?.codeChallenge) loginUrl.searchParams.set("code_challenge", oauthState.codeChallenge)
            if (oauthState?.codeChallengeMethod) loginUrl.searchParams.set("code_challenge_method", oauthState.codeChallengeMethod)
            if (oauthState?.scope) loginUrl.searchParams.set("scope", oauthState.scope)

            navigate(`${loginUrl.pathname}${loginUrl.search}`)
        }

        handleCallback()
        return () => controller.abort()
    }, [searchParams, navigate, handleWebSession])

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-sm text-muted-foreground">Redirecting...</p>
            </div>
        )
    }

    return <LoadingSpinner />
}
