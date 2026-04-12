import { useState, useRef, useMemo } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, ShieldAlert } from "lucide-react"
import { OxyServices } from "@oxyhq/core"
import type { AppColorName } from "@oxyhq/bloom/theme"
import { Avatar } from "@oxyhq/bloom/avatar"
import { buildAuthUrl, buildApiUrl, getApiBaseUrl, getAvatarUrl } from "@/lib/oxy-api-client"
import { setFedCMLoginStatus, buildPostLoginRedirect } from "@/lib/auth-utils"
import { applyColorPreset } from "@/lib/bloom-css"
import { useLayoutContext } from "@/lib/layout-context"
import { meResponseSchema, loginResponseSchema, safeParse } from "@/lib/schemas"
import type { Account } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/password-input"
import { AccountSwitcher } from "@/components/account-switcher"
import { SocialLoginButtons } from "@/components/social-login-buttons"
import { AuthFormLayout, AuthFormHeader, LoadingSpinner } from "@/components/auth-form-layout"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"

type LoginFormProps = React.ComponentProps<"div"> & {
    error?: string
    notice?: string
    sessionToken?: string
    redirectUri?: string
    state?: string
    responseType?: string
    clientId?: string
}

type LoginStep = "identifier" | "password" | "2fa" | "security-alert"

type LookupResult = {
    username: string
    displayName: string
    avatar: string | null
    color: string | null
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
    const isOAuthFlow = responseType === "token" && redirectUri
    const navigate = useNavigate()
    const oxy = useMemo(() => new OxyServices({ baseURL: getApiBaseUrl() }), [])
    const { setHideLogo } = useLayoutContext()

    const [localError, setLocalError] = useState<string | undefined>()
    const [rateLimitSeconds, setRateLimitSeconds] = useState(0)
    const displayError = rateLimitSeconds > 0 ? `Too many attempts. Try again in ${rateLimitSeconds}s.` : (localError ?? error)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isLoading, setIsLoading] = useState(true)
    const [existingAccount, setExistingAccount] = useState<Account | null>(null)
    const [existingSessionId, setExistingSessionId] = useState<string | null>(null)
    const [showLoginForm, setShowLoginForm] = useState(false)

    const [stepState, setStepState] = useState<{ step: LoginStep; direction: "forward" | "back" }>({
        step: "identifier",
        direction: "forward",
    })
    const { step, direction } = stepState

    const [identifier, setIdentifier] = useState("")
    const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
    const [loginToken, setLoginToken] = useState("")
    const [otpValue, setOtpValue] = useState("")
    const [useBackupCode, setUseBackupCode] = useState(false)
    const [backupCode, setBackupCode] = useState("")
    const [securityAlert, setSecurityAlert] = useState<string | null>(null)
    const [pendingRedirect, setPendingRedirect] = useState<{ sessionId: string; accessToken?: string; expiresAt?: string } | null>(null)

    const passwordRef = useRef<HTMLInputElement>(null)
    const identifierRef = useRef<HTMLInputElement>(null)

    // Reset color on mount
    const mountedRef = useRef(false)
    if (!mountedRef.current) {
        mountedRef.current = true
        applyColorPreset("oxy")
    }

    // One-time toasts from URL params
    const noticeShownRef = useRef(false)
    if (notice && !noticeShownRef.current) {
        noticeShownRef.current = true
        queueMicrotask(() => toast("Notice", { description: notice }))
    }
    const errorShownRef = useRef(false)
    if (error && !errorShownRef.current) {
        errorShownRef.current = true
        queueMicrotask(() => toast.error("Sign in failed", { description: error }))
    }

    // Check existing session on mount
    const sessionCheckedRef = useRef(false)
    if (!sessionCheckedRef.current) {
        sessionCheckedRef.current = true
        fetch(buildApiUrl("/users/me"), { credentials: "include" })
            .then((res) => res.ok ? res.json() : null)
            .then((data) => {
                const parsed = safeParse(meResponseSchema, data)
                if (parsed?.user && parsed.sessionId) {
                    setExistingAccount(parsed.user as Account)
                    setExistingSessionId(parsed.sessionId)
                }
            })
            .catch(() => {})
            .finally(() => setIsLoading(false))
    }

    // Rate limit countdown
    const rateLimitTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
    function startRateLimitCountdown(seconds: number) {
        setRateLimitSeconds(seconds)
        if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
        rateLimitTimerRef.current = setInterval(() => {
            setRateLimitSeconds((prev) => {
                if (prev <= 1) {
                    if (rateLimitTimerRef.current) clearInterval(rateLimitTimerRef.current)
                    return 0
                }
                return prev - 1
            })
        }, 1000)
    }

    function handleApiError(response: Response, payload: Record<string, unknown> | null): string {
        if (response.status === 429) {
            const retryAfter = Number(response.headers.get("retry-after")) || 60
            startRateLimitCountdown(retryAfter)
            return `Too many attempts. Try again in ${retryAfter}s.`
        }
        return typeof payload?.message === "string" ? payload.message : "Something went wrong"
    }

    function goToStep(next: LoginStep, dir: "forward" | "back" = "forward") {
        setLocalError(undefined)
        if (next === "identifier") {
            applyColorPreset("oxy")
            setLookupResult(null)
            setHideLogo(false)
        } else {
            setHideLogo(true)
        }
        setStepState({ step: next, direction: dir })
        requestAnimationFrame(() => {
            if (next === "password") passwordRef.current?.focus()
            else if (next === "identifier") identifierRef.current?.focus()
        })
    }

    async function handleIdentifierSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const username = identifier.trim()
        if (!username || rateLimitSeconds > 0) return

        setLocalError(undefined)
        setIsSubmitting(true)

        try {
            const result = await oxy.lookupUsername(username)
            setLookupResult({
                username: result.username,
                displayName: result.displayName,
                avatar: result.avatar,
                color: result.color,
            })
            if (result.color) applyColorPreset(result.color as AppColorName)
            setIsSubmitting(false)
            goToStep("password", "forward")
        } catch {
            setLocalError("Couldn't find your account. Check your username and try again.")
            setIsSubmitting(false)
        }
    }

    function redirectAfterLogin(sessionId: string, accessToken?: string, expiresAt?: string) {
        setFedCMLoginStatus(sessionId)
        sessionStorage.setItem("oxy_session_id", sessionId)
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

        navigate(buildPostLoginRedirect({ sessionToken, redirectUri, state }))
    }

    function completeLogin(sessionId: string, accessToken?: string, expiresAt?: string, alert?: string) {
        if (alert) {
            setSecurityAlert(alert)
            setPendingRedirect({ sessionId, accessToken, expiresAt })
            goToStep("security-alert", "forward")
            return
        }
        redirectAfterLogin(sessionId, accessToken, expiresAt)
    }

    async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLocalError(undefined)
        setIsSubmitting(true)

        const password = String(new FormData(e.currentTarget).get("password") || "")

        try {
            const response = await fetch(buildAuthUrl("/login"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ identifier: identifier.trim(), password }),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                const msg = handleApiError(response, payload)
                setLocalError(msg)
                if (response.status !== 429) toast.error("Sign in failed", { description: msg })
                setIsSubmitting(false)
                return
            }

            const parsed = safeParse(loginResponseSchema, payload)
            if (!parsed) {
                setLocalError("Unable to sign in")
                setIsSubmitting(false)
                return
            }

            if (parsed.twoFactorRequired && parsed.loginToken) {
                setLoginToken(parsed.loginToken)
                setIsSubmitting(false)
                goToStep("2fa", "forward")
                return
            }

            if (!parsed.sessionId) {
                setLocalError("Unable to sign in")
                setIsSubmitting(false)
                return
            }

            completeLogin(parsed.sessionId, parsed.accessToken, parsed.expiresAt, payload.securityAlert)
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Unable to sign in")
            setIsSubmitting(false)
        }
    }

    async function handle2FASubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLocalError(undefined)
        setIsSubmitting(true)

        const body: Record<string, string> = { loginToken }
        if (useBackupCode) body.backupCode = backupCode.trim()
        else body.token = otpValue

        try {
            // Correct endpoint: /security/2fa/verify-login (creates session)
            const response = await fetch(buildApiUrl("/security/2fa/verify-login"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                const msg = handleApiError(response, payload)
                setLocalError(msg)
                if (response.status !== 429) toast.error("Verification failed", { description: msg })
                setIsSubmitting(false)
                return
            }

            const parsed = safeParse(loginResponseSchema, payload)
            if (!parsed?.sessionId) {
                setLocalError("Unable to verify")
                setIsSubmitting(false)
                return
            }

            completeLogin(parsed.sessionId, parsed.accessToken, parsed.expiresAt, payload.securityAlert)
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Unable to verify")
            setIsSubmitting(false)
        }
    }

    async function handleContinueWithAccount() {
        if (!existingSessionId) return
        setIsSubmitting(true)

        try {
            const res = await fetch(buildAuthUrl(`/token/${existingSessionId}`), { credentials: "include" })
            const data = await res.json().catch(() => ({}))

            if (!res.ok || !data.accessToken) {
                setExistingAccount(null)
                setExistingSessionId(null)
                setShowLoginForm(true)
                toast.error("Session expired", { description: "Please sign in again" })
                setIsSubmitting(false)
                return
            }

            redirectAfterLogin(existingSessionId, data.accessToken, data.expiresAt)
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Unable to continue")
            setIsSubmitting(false)
        }
    }

    function handleSecurityAlertDismiss() {
        if (pendingRedirect) {
            redirectAfterLogin(pendingRedirect.sessionId, pendingRedirect.accessToken, pendingRedirect.expiresAt)
        }
    }

    // Resolve app context for OAuth flows
    const appContext = sessionToken ? "Sign in to continue" : "Use your Oxy account"

    if (isLoading) return <LoadingSpinner className={className} />

    if (existingAccount && existingSessionId && !showLoginForm) {
        return (
            <AccountSwitcher
                className={className}
                account={existingAccount}
                onContinue={handleContinueWithAccount}
                onUseAnother={() => setShowLoginForm(true)}
                isLoading={isSubmitting}
                {...props}
            />
        )
    }

    const animationClass = direction === "forward" ? "auth-step-forward" : "auth-step-back"

    return (
        <AuthFormLayout
            className={className}
            footer={step === "identifier" ? (
                <SocialLoginButtons sessionToken={sessionToken} redirectUri={redirectUri} state={state} />
            ) : undefined}
            {...props}
        >
            {/* Step 1: Username */}
            {step === "identifier" && (
                <form onSubmit={handleIdentifierSubmit} key="identifier" className={animationClass}>
                    <FieldGroup>
                        <AuthFormHeader title="Sign in" description={appContext} />
                        <Field data-invalid={displayError ? true : undefined}>
                            <FieldLabel htmlFor="identifier">Username</FieldLabel>
                            <Input
                                ref={identifierRef}
                                id="identifier"
                                name="identifier"
                                type="text"
                                placeholder="yourname"
                                autoComplete="username"
                                value={identifier}
                                onChange={(e) => {
                                    setIdentifier(e.target.value)
                                    if (localError) setLocalError(undefined)
                                }}
                                required
                                autoFocus
                                disabled={rateLimitSeconds > 0}
                            />
                            {displayError && <FieldError>{displayError}</FieldError>}
                        </Field>
                        <FieldDescription>
                            Don&apos;t have an account?{" "}
                            <Link to="/signup">Create account</Link>
                        </FieldDescription>
                        <Field>
                            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting || rateLimitSeconds > 0}>
                                {isSubmitting ? "Looking up..." : "Next"}
                            </Button>
                        </Field>
                    </FieldGroup>
                </form>
            )}

            {/* Step 2: Password — shows avatar + display name */}
            {step === "password" && (
                <form onSubmit={handlePasswordSubmit} key="password" className={animationClass}>
                    <FieldGroup>
                        <div className="flex items-center gap-4">
                            <Avatar
                                source={lookupResult?.avatar ? getAvatarUrl(lookupResult.avatar) : undefined}
                                size={56}
                            />
                            <div className="min-w-0">
                                <h1 className="text-3xl font-extrabold tracking-tight">
                                    Welcome, {(lookupResult?.displayName || identifier).split(" ")[0]}!
                                </h1>
                                <p className="text-sm text-muted-foreground">@{identifier}</p>
                            </div>
                        </div>
                        <Field data-invalid={displayError ? true : undefined}>
                            <FieldLabel htmlFor="password">Enter your password</FieldLabel>
                            <PasswordInput ref={passwordRef} id="password" name="password" placeholder="Password" autoComplete="current-password" required />
                            {displayError && <FieldError>{displayError}</FieldError>}
                        </Field>
                        <FieldDescription>
                            <Link to={`/recover?identifier=${encodeURIComponent(identifier.trim())}`} className="text-primary hover:underline">
                                Forgot password?
                            </Link>
                        </FieldDescription>
                        <div className="flex gap-3">
                            <Button type="button" variant="outline" size="lg" onClick={() => goToStep("identifier", "back")} className="shrink-0">
                                <ArrowLeft className="size-4" />
                            </Button>
                            <Button type="submit" size="lg" className="flex-1 min-w-0" disabled={isSubmitting || rateLimitSeconds > 0}>
                                {isSubmitting ? "Signing in..." : "Sign in"}
                            </Button>
                        </div>
                    </FieldGroup>
                </form>
            )}

            {/* Step 3: 2FA */}
            {step === "2fa" && (
                <form onSubmit={handle2FASubmit} key="2fa" className={animationClass}>
                    <FieldGroup>
                        <AuthFormHeader
                            title="2-Step Verification"
                            description={useBackupCode ? "Enter one of your backup codes" : "Enter the 6-digit code from your authenticator app"}
                        />
                        {useBackupCode ? (
                            <Field>
                                <FieldLabel htmlFor="backupCode">Backup code</FieldLabel>
                                <Input id="backupCode" name="backupCode" type="text" placeholder="xxxxxxxx" autoComplete="one-time-code" value={backupCode} onChange={(e) => setBackupCode(e.target.value)} required autoFocus />
                            </Field>
                        ) : (
                            <Field className="flex flex-col items-center">
                                <InputOTP maxLength={6} value={otpValue} onChange={setOtpValue} autoFocus>
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
                        <FieldDescription>
                            <button type="button" className="text-primary hover:underline" onClick={() => { setUseBackupCode((v) => !v); setLocalError(undefined) }}>
                                {useBackupCode ? "Use authenticator app" : "Use a backup code"}
                            </button>
                        </FieldDescription>
                        <div className="flex gap-3">
                            <Button type="button" variant="outline" size="lg" onClick={() => { setOtpValue(""); setBackupCode(""); setLoginToken(""); goToStep("password", "back") }} className="shrink-0">
                                <ArrowLeft className="size-4" />
                            </Button>
                            <Button type="submit" size="lg" className="flex-1 min-w-0" disabled={isSubmitting || rateLimitSeconds > 0}>
                                {isSubmitting ? "Verifying..." : "Verify"}
                            </Button>
                        </div>
                    </FieldGroup>
                </form>
            )}

            {/* Step 4: Security alert (new device, unusual location, etc.) */}
            {step === "security-alert" && (
                <div key="security-alert" className={animationClass}>
                    <FieldGroup>
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="size-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                <ShieldAlert className="size-8 text-amber-600 dark:text-amber-400" />
                            </div>
                            <h1 className="text-3xl font-extrabold tracking-tight">New sign-in detected</h1>
                            <p className="text-base text-muted-foreground">{securityAlert}</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Button variant="outline" size="lg" className="flex-1" onClick={() => { setPendingRedirect(null); goToStep("identifier", "back") }}>
                                That wasn&apos;t me
                            </Button>
                            <Button size="lg" className="flex-1" onClick={handleSecurityAlertDismiss}>
                                Yes, it was me
                            </Button>
                        </div>
                    </FieldGroup>
                </div>
            )}
        </AuthFormLayout>
    )
}
