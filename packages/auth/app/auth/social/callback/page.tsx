"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams, useRouter } from "next/navigation"

type OAuthState = {
    provider: string
    sessionToken: string
    redirectUri: string
    state: string
}

function parseOAuthState(raw: string | null): OAuthState | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(atob(raw))
        if (typeof parsed.provider !== "string") return null
        return parsed as OAuthState
    } catch {
        return null
    }
}

function SocialCallbackContent() {
    const searchParams = useSearchParams()
    const router = useRouter()
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        async function handleCallback() {
            const code = searchParams.get("code")
            const rawState = searchParams.get("state")
            const urlError = searchParams.get("error")

            if (urlError) {
                const description =
                    searchParams.get("error_description") || urlError
                redirectToLogin(description, rawState)
                return
            }

            if (!code) {
                redirectToLogin("No authorization code received", rawState)
                return
            }

            const oauthState = parseOAuthState(rawState)
            if (!oauthState || !oauthState.provider) {
                redirectToLogin("Invalid OAuth state", rawState)
                return
            }

            try {
                const response = await fetch(
                    `/api/auth/social/${oauthState.provider}`,
                    {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ code }),
                    }
                )

                const payload = await response.json().catch(() => ({}))

                if (!response.ok || !payload?.sessionId) {
                    const message =
                        typeof payload?.message === "string"
                            ? payload.message
                            : "Social sign in failed"
                    redirectToLogin(message, rawState)
                    return
                }

                // Set FedCM login status via iframe
                const loginStatusFrame = document.createElement("iframe")
                loginStatusFrame.style.display = "none"
                loginStatusFrame.src = "/api/fedcm/login-status"
                document.body.appendChild(loginStatusFrame)
                setTimeout(() => loginStatusFrame.remove(), 1000)

                // Redirect same as login form after success
                const nextUrl = new URL("/authorize", window.location.origin)
                if (oauthState.sessionToken) {
                    nextUrl.searchParams.set("token", oauthState.sessionToken)
                }
                if (oauthState.redirectUri) {
                    nextUrl.searchParams.set(
                        "redirect_uri",
                        oauthState.redirectUri
                    )
                }
                if (oauthState.state) {
                    nextUrl.searchParams.set("state", oauthState.state)
                }
                if (!oauthState.sessionToken && !oauthState.redirectUri) {
                    nextUrl.searchParams.set(
                        "error",
                        "No authorization request found. Return to the app and try again."
                    )
                }
                router.push(`${nextUrl.pathname}${nextUrl.search}`)
            } catch {
                redirectToLogin("Social sign in failed", rawState)
            }
        }

        function redirectToLogin(message: string, rawState: string | null) {
            setError(message)
            const loginUrl = new URL("/login", window.location.origin)
            loginUrl.searchParams.set("error", message)

            const oauthState = parseOAuthState(rawState)
            if (oauthState) {
                if (oauthState.sessionToken) {
                    loginUrl.searchParams.set("token", oauthState.sessionToken)
                }
                if (oauthState.redirectUri) {
                    loginUrl.searchParams.set(
                        "redirect_uri",
                        oauthState.redirectUri
                    )
                }
                if (oauthState.state) {
                    loginUrl.searchParams.set("state", oauthState.state)
                }
            }

            router.push(`${loginUrl.pathname}${loginUrl.search}`)
        }

        handleCallback()
    }, [searchParams, router])

    return (
        <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
                {error ? (
                    <p className="text-sm text-muted-foreground">
                        Redirecting...
                    </p>
                ) : (
                    <>
                        <div className="mb-4">
                            <div className="animate-spin h-8 w-8 mx-auto border-4 border-primary border-t-transparent rounded-full" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Completing sign in...
                        </p>
                    </>
                )}
            </div>
        </div>
    )
}

export default function SocialCallbackPage() {
    return (
        <Suspense
            fallback={
                <div className="flex items-center justify-center min-h-screen">
                    <div className="text-center">
                        <div className="mb-4">
                            <div className="animate-spin h-8 w-8 mx-auto border-4 border-primary border-t-transparent rounded-full" />
                        </div>
                        <p className="text-sm text-muted-foreground">
                            Completing sign in...
                        </p>
                    </div>
                </div>
            }
        >
            <SocialCallbackContent />
        </Suspense>
    )
}
