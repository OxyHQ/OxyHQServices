import { useEffect, useState, useRef } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"

import { buildAuthUrl, buildApiUrl } from "@/lib/oxy-api-client"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/password-input"
import { AccountSwitcher } from "@/components/account-switcher"
import { SocialLoginButtons } from "@/components/social-login-buttons"
import { Logo } from "@/components/logo"
import {
    InputOTP,
    InputOTPGroup,
    InputOTPSlot,
} from "@/components/ui/input-otp"

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

type LoginStep = "identifier" | "password" | "2fa"

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
    const isOAuthFlow = responseType === "token" && redirectUri
    const navigate = useNavigate()
    const [errorMessage, setErrorMessage] = useState(error)
    const [noticeMessage, setNoticeMessage] = useState(notice)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [existingAccount, setExistingAccount] = useState<Account | null>(null)
    const [existingSessionId, setExistingSessionId] = useState<string | null>(null)
    const [showLoginForm, setShowLoginForm] = useState(false)

    // Multi-step state
    const [step, setStep] = useState<LoginStep>("identifier")
    const [identifier, setIdentifier] = useState("")
    const [direction, setDirection] = useState<"forward" | "back">("forward")

    // 2FA state
    const [loginToken, setLoginToken] = useState("")
    const [otpValue, setOtpValue] = useState("")
    const [useBackupCode, setUseBackupCode] = useState(false)
    const [backupCode, setBackupCode] = useState("")

    const passwordRef = useRef<HTMLInputElement>(null)
    const identifierRef = useRef<HTMLInputElement>(null)

    // Check for existing session on mount
    useEffect(() => {
        async function checkExistingSession() {
            try {
                const response = await fetch(buildApiUrl("/users/me"), {
                    credentials: "include",
                })
                const data = await response.json()
                if (data.user && data.sessionId) {
                    setExistingAccount(data.user)
                    setExistingSessionId(data.sessionId)
                }
            } catch {
                // No existing session - show login form
            } finally {
                setIsLoading(false)
            }
        }
        checkExistingSession()
    }, [])

    useEffect(() => {
        setErrorMessage(error)
        if (error) toast.error("Sign in failed", { description: error })
    }, [error])

    useEffect(() => {
        setNoticeMessage(notice)
        if (notice) toast("Notice", { description: notice })
    }, [notice])

    // Auto-focus fields on step change
    useEffect(() => {
        if (step === "password") {
            setTimeout(() => passwordRef.current?.focus(), 100)
        } else if (step === "identifier") {
            setTimeout(() => identifierRef.current?.focus(), 100)
        }
    }, [step])

    const goToStep = (next: LoginStep, dir: "forward" | "back" = "forward") => {
        setDirection(dir)
        setErrorMessage(undefined)
        setStep(next)
    }

    const handleIdentifierSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        const value = identifier.trim()
        if (!value) return
        goToStep("password", "forward")
    }

    const setFedCMLoginStatus = (sessionId: string) => {
        // Register the session with the FedCM server so it can set
        // the httpOnly cookie the browser needs for FedCM account lookups
        fetch("/fedcm/set-session", {
            method: "POST",
            headers: { "content-type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ sessionId, action: "login" }),
        }).catch(() => {
            // Best-effort -- FedCM is an enhancement, not critical path
        })

        // Also load the login-status endpoint in an iframe to set
        // the Set-Login header for the browser's FedCM Login Status API
        const loginStatusFrame = document.createElement("iframe")
        loginStatusFrame.style.display = "none"
        loginStatusFrame.src = "/fedcm/login-status"
        document.body.appendChild(loginStatusFrame)
        setTimeout(() => loginStatusFrame.remove(), 1000)
    }

    const redirectAfterLogin = (sessionId: string, accessToken?: string, expiresAt?: string) => {
        setFedCMLoginStatus(sessionId)

        // Store credentials so authorize page can use them
        if (sessionId) sessionStorage.setItem("oxy_session_id", sessionId)
        if (accessToken) sessionStorage.setItem("oxy_access_token", accessToken)

        if (isOAuthFlow && redirectUri) {
            const callbackUrl = new URL(redirectUri)
            callbackUrl.searchParams.set("session_id", sessionId)
            callbackUrl.searchParams.set("access_token", accessToken || "")
            callbackUrl.searchParams.set("expires_at", expiresAt || "")
            if (state) callbackUrl.searchParams.set("state", state)
            callbackUrl.searchParams.set("redirect_uri", clientId || window.location.origin)
            window.location.href = callbackUrl.toString()
            return
        }

        const nextUrl = new URL("/authorize", window.location.origin)
        if (sessionToken) nextUrl.searchParams.set("token", sessionToken)
        if (redirectUri) nextUrl.searchParams.set("redirect_uri", redirectUri)
        if (state) nextUrl.searchParams.set("state", state)
        if (!sessionToken && !redirectUri) {
            nextUrl.searchParams.set("error", "No authorization request found. Return to the app and try again.")
        }
        navigate(`${nextUrl.pathname}${nextUrl.search}`)
    }

    const handlePasswordSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setErrorMessage(undefined)
        setIsSubmitting(true)

        const formData = new FormData(e.currentTarget)
        const password = String(formData.get("password") || "")

        try {
            const response = await fetch(buildAuthUrl("/login"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ identifier: identifier.trim(), password }),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                setErrorMessage(typeof payload?.message === "string" ? payload.message : "Unable to sign in")
                setIsSubmitting(false)
                return
            }

            // Check for 2FA requirement
            if (payload?.twoFactorRequired && payload?.loginToken) {
                setLoginToken(payload.loginToken)
                setIsSubmitting(false)
                goToStep("2fa", "forward")
                return
            }

            if (!payload?.sessionId) {
                setErrorMessage("Unable to sign in")
                setIsSubmitting(false)
                return
            }

            redirectAfterLogin(payload.sessionId, payload.accessToken, payload.expiresAt)
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : "Unable to sign in")
            setIsSubmitting(false)
        }
    }

    const handle2FASubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        setErrorMessage(undefined)
        setIsSubmitting(true)

        const body: Record<string, string> = { loginToken }
        if (useBackupCode) {
            body.backupCode = backupCode.trim()
        } else {
            body.token = otpValue
        }

        try {
            const response = await fetch(buildAuthUrl("/2fa/verify"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                setErrorMessage(typeof payload?.message === "string" ? payload.message : "Invalid code")
                setIsSubmitting(false)
                return
            }

            if (!payload?.sessionId) {
                setErrorMessage("Unable to verify")
                setIsSubmitting(false)
                return
            }

            redirectAfterLogin(payload.sessionId, payload.accessToken, payload.expiresAt)
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : "Unable to verify")
            setIsSubmitting(false)
        }
    }

    const handleContinueWithAccount = async () => {
        if (!existingSessionId) return

        setIsSubmitting(true)
        try {
            const tokenResponse = await fetch(buildAuthUrl(`/token/${existingSessionId}`), {
                credentials: "include",
            })
            const tokenData = await tokenResponse.json().catch(() => ({}))

            if (!tokenResponse.ok || !tokenData.accessToken) {
                setExistingAccount(null)
                setExistingSessionId(null)
                setShowLoginForm(true)
                toast.error("Session expired", { description: "Please sign in again" })
                setIsSubmitting(false)
                return
            }

            redirectAfterLogin(existingSessionId, tokenData.accessToken, tokenData.expiresAt)
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : "Unable to continue")
            setIsSubmitting(false)
        }
    }

    // Loading state
    if (isLoading) {
        return (
            <div className={cn("flex flex-col gap-6 items-center justify-center min-h-[300px]", className)} {...props}>
                <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
            </div>
        )
    }

    // Account switcher
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

    const animationClass = direction === "forward" ? "auth-step-forward" : "auth-step-back"

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            {/* Step 1: Identifier */}
            {step === "identifier" && (
                <>
                    <form onSubmit={handleIdentifierSubmit} key="identifier" className={animationClass}>
                        <FieldGroup>
                            <div className="flex flex-col items-center gap-2 text-center">
                                <a href="#" className="flex flex-col items-center gap-2 font-medium">
                                    <Logo />
                                    <span className="sr-only">Oxy</span>
                                </a>
                                <h1 className="text-xl font-bold">Sign in</h1>
                                <FieldDescription>Use your Oxy account</FieldDescription>
                            </div>
                            <Field>
                                <FieldLabel htmlFor="identifier">Email or username</FieldLabel>
                                <Input
                                    ref={identifierRef}
                                    id="identifier"
                                    name="identifier"
                                    type="text"
                                    placeholder="m@example.com"
                                    autoComplete="username"
                                    value={identifier}
                                    onChange={(e) => setIdentifier(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </Field>
                            <FieldDescription className="text-center">
                                Don&apos;t have an account?{" "}
                                <Link to="/signup">Create account</Link>
                            </FieldDescription>
                            <Field>
                                <Button type="submit" className="w-full">Next</Button>
                            </Field>
                        </FieldGroup>
                    </form>
                    <SocialLoginButtons
                        sessionToken={sessionToken}
                        redirectUri={redirectUri}
                        state={state}
                    />
                </>
            )}

            {/* Step 2: Password */}
            {step === "password" && (
                <form onSubmit={handlePasswordSubmit} key="password" className={animationClass}>
                    <FieldGroup>
                        <div className="flex flex-col items-center gap-2 text-center">
                            <a href="#" className="flex flex-col items-center gap-2 font-medium">
                                <Logo />
                                <span className="sr-only">Oxy</span>
                            </a>
                            <h1 className="text-xl font-bold">Welcome</h1>
                            <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                                {identifier}
                            </div>
                        </div>
                        <Field>
                            <FieldLabel htmlFor="password">Enter your password</FieldLabel>
                            <PasswordInput
                                ref={passwordRef}
                                id="password"
                                name="password"
                                placeholder="Password"
                                autoComplete="current-password"
                                required
                            />
                        </Field>
                        <FieldDescription>
                            <Link
                                to={`/recover?identifier=${encodeURIComponent(identifier.trim())}`}
                                className="text-primary hover:underline"
                            >
                                Forgot password?
                            </Link>
                        </FieldDescription>
                        <Field className="flex gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => goToStep("identifier", "back")}
                                className="shrink-0"
                            >
                                <ArrowLeft className="size-4" />
                            </Button>
                            <Button type="submit" className="flex-1" disabled={isSubmitting}>
                                {isSubmitting ? "Signing in..." : "Sign in"}
                            </Button>
                        </Field>
                    </FieldGroup>
                </form>
            )}

            {/* Step 3: 2FA */}
            {step === "2fa" && (
                <form onSubmit={handle2FASubmit} key="2fa" className={animationClass}>
                    <FieldGroup>
                        <div className="flex flex-col items-center gap-2 text-center">
                            <a href="#" className="flex flex-col items-center gap-2 font-medium">
                                <Logo />
                                <span className="sr-only">Oxy</span>
                            </a>
                            <h1 className="text-xl font-bold">2-Step Verification</h1>
                            <FieldDescription>
                                {useBackupCode
                                    ? "Enter one of your backup codes"
                                    : "Enter the 6-digit code from your authenticator app"}
                            </FieldDescription>
                        </div>

                        {useBackupCode ? (
                            <Field>
                                <FieldLabel htmlFor="backupCode">Backup code</FieldLabel>
                                <Input
                                    id="backupCode"
                                    name="backupCode"
                                    type="text"
                                    placeholder="xxxxxxxx"
                                    autoComplete="one-time-code"
                                    value={backupCode}
                                    onChange={(e) => setBackupCode(e.target.value)}
                                    required
                                    autoFocus
                                />
                            </Field>
                        ) : (
                            <Field className="flex flex-col items-center">
                                <InputOTP
                                    maxLength={6}
                                    value={otpValue}
                                    onChange={setOtpValue}
                                    autoFocus
                                >
                                    <InputOTPGroup>
                                        <InputOTPSlot index={0} />
                                        <InputOTPSlot index={1} />
                                        <InputOTPSlot index={2} />
                                        <InputOTPSlot index={3} />
                                        <InputOTPSlot index={4} />
                                        <InputOTPSlot index={5} />
                                    </InputOTPGroup>
                                </InputOTP>
                            </Field>
                        )}

                        <FieldDescription className="text-center">
                            <button
                                type="button"
                                className="text-primary hover:underline"
                                onClick={() => {
                                    setUseBackupCode((v) => !v)
                                    setErrorMessage(undefined)
                                }}
                            >
                                {useBackupCode ? "Use authenticator app" : "Use a backup code"}
                            </button>
                        </FieldDescription>

                        <Field className="flex gap-3">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    setOtpValue("")
                                    setBackupCode("")
                                    setLoginToken("")
                                    goToStep("password", "back")
                                }}
                                className="shrink-0"
                            >
                                <ArrowLeft className="size-4" />
                            </Button>
                            <Button type="submit" className="flex-1" disabled={isSubmitting}>
                                {isSubmitting ? "Verifying..." : "Verify"}
                            </Button>
                        </Field>
                    </FieldGroup>
                </form>
            )}

            <FieldDescription className="px-6 text-center">
                By clicking continue, you agree to our{" "}
                <a href="https://oxy.so/company/transparency/policies/terms-of-service">Terms of Service</a>{" "}
                and{" "}
                <a href="https://oxy.so/company/transparency/policies/privacy">Privacy Policy</a>.
            </FieldDescription>
        </div>
    )
}
