"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AccountSwitcher } from "@/components/account-switcher"
import { Logo } from "@/components/logo"

type Account = {
    id: string
    username?: string
    email?: string
    avatar?: string
    displayName?: string
}

type LoginFormProps = React.ComponentProps<"div"> & {
    error?: string
    notice?: string
    sessionToken?: string
    redirectUri?: string
    state?: string
    responseType?: string
    clientId?: string
}

export function LoginForm({
    className,
    error,
    notice,
    sessionToken,
    redirectUri,
    state,
    responseType,
    clientId,
    ...props
}: LoginFormProps) {
    // Check if this is a popup OAuth flow (response_type=token)
    const isOAuthFlow = responseType === "token" && redirectUri
    const router = useRouter()
    const [errorMessage, setErrorMessage] = useState(error)
    const [noticeMessage, setNoticeMessage] = useState(notice)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [existingAccount, setExistingAccount] = useState<Account | null>(null)
    const [existingSessionId, setExistingSessionId] = useState<string | null>(null)
    const [showLoginForm, setShowLoginForm] = useState(false)
    const formAction = "/api/auth/login"

    // Check for existing session on mount
    useEffect(() => {
        async function checkExistingSession() {
            try {
                const response = await fetch("/api/auth/me", {
                    credentials: "include",
                })
                const data = await response.json()
                if (data.user && data.sessionId) {
                    setExistingAccount(data.user)
                    setExistingSessionId(data.sessionId)
                }
            } catch {
                // No existing session or error - show login form
            } finally {
                setIsLoading(false)
            }
        }
        checkExistingSession()
    }, [])

    useEffect(() => {
        setErrorMessage(error)
    }, [error])

    useEffect(() => {
        setNoticeMessage(notice)
    }, [notice])

    useEffect(() => {
        if (noticeMessage) {
            toast("Notice", { description: noticeMessage })
        }
    }, [noticeMessage])

    useEffect(() => {
        if (errorMessage) {
            toast.error("Sign in failed", { description: errorMessage })
        }
    }, [errorMessage])

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setErrorMessage(undefined)
        setNoticeMessage(undefined)
        setIsSubmitting(true)

        const formData = new FormData(event.currentTarget)
        const identifier = String(formData.get("identifier") || "").trim()
        const password = String(formData.get("password") || "")
        let didRedirect = false

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({ identifier, password }),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                const message =
                    typeof payload?.message === "string"
                        ? payload.message
                        : "Unable to sign in"
                setErrorMessage(message)
                return
            }

            if (!payload?.sessionId) {
                setErrorMessage("Unable to sign in")
                return
            }

            // Session cookie is now set server-side with httpOnly flag
            // by the /api/auth/login route handler (Set-Cookie response header).

            // Set FedCM login status via iframe
            // The browser's FedCM Login Status API only processes Set-Login header
            // from top-level frame navigations, not from fetch/XHR responses.
            // Loading this endpoint in an iframe signals to the browser that
            // the user is logged in at this IdP, enabling FedCM silent SSO.
            const loginStatusFrame = document.createElement("iframe")
            loginStatusFrame.style.display = "none"
            loginStatusFrame.src = "/api/fedcm/login-status"
            document.body.appendChild(loginStatusFrame)
            // Clean up after a short delay (browser processes the header immediately)
            setTimeout(() => {
                loginStatusFrame.remove()
            }, 1000)

            // OAuth popup flow: redirect directly to callback with session data
            if (isOAuthFlow && redirectUri) {
                const callbackUrl = new URL(redirectUri)
                callbackUrl.searchParams.set("session_id", payload.sessionId)
                callbackUrl.searchParams.set("access_token", payload.accessToken || "")
                callbackUrl.searchParams.set("expires_at", payload.expiresAt || "")
                if (state) {
                    callbackUrl.searchParams.set("state", state)
                }
                // Also include redirect_uri for postMessage origin validation
                callbackUrl.searchParams.set("redirect_uri", clientId || window.location.origin)
                didRedirect = true
                window.location.href = callbackUrl.toString()
                return
            }

            // Standard auth flow: go to authorize page
            const nextUrl = new URL("/authorize", window.location.origin)
            if (sessionToken) {
                nextUrl.searchParams.set("token", sessionToken)
            }
            if (redirectUri) {
                nextUrl.searchParams.set("redirect_uri", redirectUri)
            }
            if (state) {
                nextUrl.searchParams.set("state", state)
            }
            if (!sessionToken && !redirectUri) {
                nextUrl.searchParams.set(
                    "error",
                    "No authorization request found. Return to the app and try again."
                )
            }

            didRedirect = true
            router.push(`${nextUrl.pathname}${nextUrl.search}`)
        } catch (err) {
            setErrorMessage(
                err instanceof Error ? err.message : "Unable to sign in"
            )
        } finally {
            if (!didRedirect) {
                setIsSubmitting(false)
            }
        }
    }

    const handleContinueWithAccount = async () => {
        if (!existingSessionId) return

        setIsSubmitting(true)
        try {
            // Get access token for existing session
            const tokenResponse = await fetch(`/api/auth/token/${existingSessionId}`)
            const tokenData = await tokenResponse.json().catch(() => ({}))

            if (!tokenResponse.ok || !tokenData.accessToken) {
                // Session expired or invalid - show login form
                setExistingAccount(null)
                setExistingSessionId(null)
                setShowLoginForm(true)
                toast.error("Session expired", { description: "Please sign in again" })
                setIsSubmitting(false)
                return
            }

            // OAuth popup flow: redirect directly to callback with session data
            if (isOAuthFlow && redirectUri) {
                const callbackUrl = new URL(redirectUri)
                callbackUrl.searchParams.set("session_id", existingSessionId)
                callbackUrl.searchParams.set("access_token", tokenData.accessToken)
                callbackUrl.searchParams.set("expires_at", tokenData.expiresAt || "")
                if (state) {
                    callbackUrl.searchParams.set("state", state)
                }
                // Use clientId for postMessage origin - this is the client app's origin
                // If clientId is not set, we can't send postMessage to the right origin
                if (!clientId) {
                    console.error("[LoginForm] clientId is not set - cannot determine postMessage target")
                    toast.error("Configuration error", { description: "Missing client ID" })
                    setIsSubmitting(false)
                    return
                }
                callbackUrl.searchParams.set("redirect_uri", clientId)
                window.location.href = callbackUrl.toString()
                return
            }

            // Standard auth flow: go to authorize page
            const nextUrl = new URL("/authorize", window.location.origin)
            if (sessionToken) {
                nextUrl.searchParams.set("token", sessionToken)
            }
            if (redirectUri) {
                nextUrl.searchParams.set("redirect_uri", redirectUri)
            }
            if (state) {
                nextUrl.searchParams.set("state", state)
            }
            router.push(`${nextUrl.pathname}${nextUrl.search}`)
        } catch (err) {
            setErrorMessage(
                err instanceof Error ? err.message : "Unable to continue"
            )
            setIsSubmitting(false)
        }
    }

    // Show loading state while checking for existing session
    if (isLoading) {
        return (
            <div className={cn("flex flex-col gap-6 items-center justify-center min-h-[300px]", className)} {...props}>
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
        )
    }

    // Show account switcher if user has existing session and hasn't chosen to use another account
    if (existingAccount && existingSessionId && !showLoginForm) {
        return (
            <AccountSwitcher
                className={className}
                account={existingAccount}
                sessionId={existingSessionId}
                onContinue={handleContinueWithAccount}
                onUseAnother={() => setShowLoginForm(true)}
                isLoading={isSubmitting}
                {...props}
            />
        )
    }

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <form method="post" action={formAction} onSubmit={handleSubmit}>
                {sessionToken ? (
                    <input type="hidden" name="session_token" value={sessionToken} />
                ) : null}
                {redirectUri ? (
                    <input type="hidden" name="redirect_uri" value={redirectUri} />
                ) : null}
                {state ? <input type="hidden" name="state" value={state} /> : null}
                <FieldGroup>
                    <div className="flex flex-col items-center gap-2 text-center">
                        <a
                            href="#"
                            className="flex flex-col items-center gap-2 font-medium"
                        >
                            <Logo />
                            <span className="sr-only">Oxy</span>
                        </a>
                        <h1 className="text-xl font-bold">Welcome to Oxy</h1>
                        <FieldDescription>
                            Don&apos;t have an account? <a href="/signup">Sign up</a>
                        </FieldDescription>
                    </div>
                    <Field>
                        <FieldLabel htmlFor="identifier">Email or username</FieldLabel>
                        <Input
                            id="identifier"
                            name="identifier"
                            type="text"
                            placeholder="m@example.com"
                            autoComplete="username"
                            required
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="password">Password</FieldLabel>
                        <Input
                            id="password"
                            name="password"
                            type="password"
                            placeholder="password"
                            autoComplete="current-password"
                            required
                        />
                    </Field>
                    <Field>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Signing in..." : "Login"}
                        </Button>
                    </Field>
                </FieldGroup>
            </form>
            <FieldDescription className="px-6 text-center">
                By clicking continue, you agree to our <a href="https://oxy.so/company/transparency/policies/terms-of-service">Terms of Service</a>{" "}
                and <a href="https://oxy.so/company/transparency/policies/privacy">Privacy Policy</a>.
            </FieldDescription>
        </div>
    )
}
