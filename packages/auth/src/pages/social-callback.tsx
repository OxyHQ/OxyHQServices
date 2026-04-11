import { useEffect, useState } from "react"
import { useSearchParams, useNavigate } from "react-router-dom"
import { buildAuthUrl } from "@/lib/oxy-api-client"
import { setFedCMLoginStatus, buildPostLoginRedirect } from "@/lib/auth-utils"
import { LoadingSpinner } from "@/components/auth-form-layout"

type OAuthState = {
    provider: string
    sessionToken?: string
    redirectUri?: string
    state?: string
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
        }
    } catch {
        return null
    }
}

export function SocialCallbackPage() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
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

                if (!response.ok || !payload?.sessionId) {
                    const message = typeof payload?.message === "string"
                        ? payload.message
                        : "Social sign in failed"
                    redirectToLogin(message, rawState)
                    return
                }

                setFedCMLoginStatus(payload.sessionId)
                navigate(buildPostLoginRedirect({
                    sessionToken: oauthState.sessionToken,
                    redirectUri: oauthState.redirectUri,
                    state: oauthState.state,
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

            navigate(`${loginUrl.pathname}${loginUrl.search}`)
        }

        handleCallback()
        return () => controller.abort()
    }, [searchParams, navigate])

    if (error) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-sm text-muted-foreground">Redirecting...</p>
            </div>
        )
    }

    return <LoadingSpinner />
}
