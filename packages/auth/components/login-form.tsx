import { useState, useRef, useMemo } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft } from "lucide-react"
import { OxyServices } from "@oxyhq/core"
import type { AppColorName } from "@oxyhq/bloom/theme"
import { buildAuthUrl, buildApiUrl, getApiBaseUrl } from "@/lib/oxy-api-client"
import { setFedCMLoginStatus, buildPostLoginRedirect } from "@/lib/auth-utils"
import { applyColorPreset } from "@/lib/bloom-css"
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
    const oxy = useMemo(() => new OxyServices({ baseURL: getApiBaseUrl() }), [])

    const [localError, setLocalError] = useState<string | undefined>()
    const displayError = localError ?? error

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
    const [loginToken, setLoginToken] = useState("")
    const [otpValue, setOtpValue] = useState("")
    const [useBackupCode, setUseBackupCode] = useState(false)
    const [backupCode, setBackupCode] = useState("")

    const passwordRef = useRef<HTMLInputElement>(null)
    const identifierRef = useRef<HTMLInputElement>(null)

    // Reset color to default on mount (e.g. navigating back from another page)
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
            .then((res) => {
                if (!res.ok) return null
                return res.json()
            })
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

    function goToStep(next: LoginStep, dir: "forward" | "back" = "forward") {
        setLocalError(undefined)
        if (next === "identifier") applyColorPreset("oxy")
        setStepState({ step: next, direction: dir })
        requestAnimationFrame(() => {
            if (next === "password") passwordRef.current?.focus()
            else if (next === "identifier") identifierRef.current?.focus()
        })
    }

    async function handleIdentifierSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const username = identifier.trim()
        if (!username) return

        setLocalError(undefined)
        setIsSubmitting(true)

        try {
            const result = await oxy.lookupUsername(username)
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
            const payload = safeParse(loginResponseSchema, await response.json().catch(() => ({})))

            if (!response.ok || !payload) {
                const msg = payload?.message ?? "Unable to sign in"
                setLocalError(msg)
                toast.error("Sign in failed", { description: msg })
                setIsSubmitting(false)
                return
            }

            if (payload.twoFactorRequired && payload.loginToken) {
                setLoginToken(payload.loginToken)
                setIsSubmitting(false)
                goToStep("2fa", "forward")
                return
            }

            if (!payload.sessionId) {
                setLocalError("Unable to sign in")
                setIsSubmitting(false)
                return
            }

            redirectAfterLogin(payload.sessionId, payload.accessToken, payload.expiresAt)
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unable to sign in"
            setLocalError(msg)
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
            const response = await fetch(buildAuthUrl("/2fa/verify"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
            })
            const payload = safeParse(loginResponseSchema, await response.json().catch(() => ({})))

            if (!response.ok || !payload) {
                const msg = payload?.message ?? "Invalid code"
                setLocalError(msg)
                toast.error("Verification failed", { description: msg })
                setIsSubmitting(false)
                return
            }

            if (!payload.sessionId) {
                setLocalError("Unable to verify")
                setIsSubmitting(false)
                return
            }

            redirectAfterLogin(payload.sessionId, payload.accessToken, payload.expiresAt)
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unable to verify"
            setLocalError(msg)
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
            {step === "identifier" && (
                <form onSubmit={handleIdentifierSubmit} key="identifier" className={animationClass}>
                    <FieldGroup>
                        <AuthFormHeader title="Sign in" description="Use your Oxy account" />
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
                            />
                            {displayError && <FieldError>{displayError}</FieldError>}
                        </Field>
                        <FieldDescription>
                            Don&apos;t have an account?{" "}
                            <Link to="/signup">Create account</Link>
                        </FieldDescription>
                        <Field>
                            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                                {isSubmitting ? "Looking up..." : "Next"}
                            </Button>
                        </Field>
                    </FieldGroup>
                </form>
            )}

            {step === "password" && (
                <form onSubmit={handlePasswordSubmit} key="password" className={animationClass}>
                    <FieldGroup>
                        <AuthFormHeader
                            title="Welcome"
                            description={
                                <span className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">
                                    {identifier}
                                </span>
                            }
                        />
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
                            <Button type="submit" size="lg" className="flex-1 min-w-0" disabled={isSubmitting}>
                                {isSubmitting ? "Signing in..." : "Sign in"}
                            </Button>
                        </div>
                    </FieldGroup>
                </form>
            )}

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
                            <Button type="submit" size="lg" className="flex-1 min-w-0" disabled={isSubmitting}>
                                {isSubmitting ? "Verifying..." : "Verify"}
                            </Button>
                        </div>
                    </FieldGroup>
                </form>
            )}
        </AuthFormLayout>
    )
}
