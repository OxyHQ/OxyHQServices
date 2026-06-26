import { useState, useRef, useMemo, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, ShieldAlert, QrCode } from "lucide-react"
import { OxyServices } from "@oxyhq/core"
import { Avatar } from "@oxyhq/bloom/avatar"
import { buildAuthUrl, buildApiUrl, getApiBaseUrl, getAvatarUrl } from "@/lib/oxy-api-client"
import { withCsrfHeader } from "@/lib/csrf"
import { setFedCMLoginStatus, registerFedCMSession, buildPostLoginRedirect, completeFedCMLogin } from "@/lib/auth-utils"
import { setBasePreset } from "@/lib/bloom-css"
import { useLayoutContext } from "@/lib/layout-context"
import { loginResponseSchema, safeParse } from "@/lib/schemas"
import type { DeviceAccount } from "@/lib/types"
import { useDeviceAccounts } from "@/lib/use-device-accounts"
import { getOrCreateDeviceFingerprint } from "@/lib/device-fingerprint"
import { Button } from "@oxyhq/bloom/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/password-input"
import { AccountChooser } from "@/components/account-chooser"
import { SocialLoginButtons } from "@/components/social-login-buttons"
import { CommonsSignIn } from "@/components/commons-signin"
import { AuthFormLayout, AuthFormHeader, LoadingSpinner } from "@/components/auth-form-layout"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { OXY_CLIENT_ID } from "@/lib/oxy-client"

type LoginFormProps = React.ComponentProps<"div"> & {
    error?: string
    notice?: string
    sessionToken?: string
    redirectUri?: string
    state?: string
    clientId?: string
    codeChallenge?: string
    codeChallengeMethod?: string
    scope?: string
    /**
     * Username to pre-fill and re-authenticate. Set via `?login_hint=` when a
     * caller (e.g. the OAuth consent page's re-auth fallback) routes a specific
     * account here for explicit sign-in — bypasses the chooser and jumps to the
     * password step for that account.
     */
    loginHint?: string
}

type LoginStep = "identifier" | "password" | "2fa" | "security-alert" | "commons"

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
    clientId,
    codeChallenge,
    codeChallengeMethod,
    scope,
    loginHint,
    ...props
}: LoginFormProps) {
    const navigate = useNavigate()
    const oxy = useMemo(() => new OxyServices({ baseURL: getApiBaseUrl() }), [])
    const { setLogoSlot } = useLayoutContext()

    const [localError, setLocalError] = useState<string | undefined>()
    const [rateLimitSeconds, setRateLimitSeconds] = useState(0)
    const displayError = rateLimitSeconds > 0 ? `Too many attempts. Try again in ${rateLimitSeconds}s.` : (localError ?? error)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [pendingSessionId, setPendingSessionId] = useState<string | null>(null)
    // When a login_hint is supplied (the chooser routed a non-active account
    // here for re-auth), bypass the chooser and go straight to the sign-in form.
    const [showLoginForm, setShowLoginForm] = useState(Boolean(loginHint))

    // Detect every account signed in on this device (1..N). The chooser is shown
    // as an additive front screen whenever at least one account is present and
    // the user hasn't opted into "Use a different account".
    const { isLoading, currentSessionId, accounts } = useDeviceAccounts()

    const [stepState, setStepState] = useState<{ step: LoginStep; direction: "forward" | "back" }>({
        step: "identifier",
        direction: "forward",
    })
    const { step, direction } = stepState

    const [identifier, setIdentifier] = useState(loginHint ?? "")
    const [lookupResult, setLookupResult] = useState<LookupResult | null>(null)
    const [loginToken, setLoginToken] = useState("")
    const [otpValue, setOtpValue] = useState("")
    const [useBackupCode, setUseBackupCode] = useState(false)
    const [backupCode, setBackupCode] = useState("")
    const [securityAlert, setSecurityAlert] = useState<string | null>(null)
    const [pendingRedirect, setPendingRedirect] = useState<{ sessionId: string; authuser?: number } | null>(null)

    const passwordRef = useRef<HTMLInputElement>(null)
    const identifierRef = useRef<HTMLInputElement>(null)

    // Reset color on mount
    const mountedRef = useRef(false)
    if (!mountedRef.current) {
        mountedRef.current = true
        setBasePreset("oxy")
    }

    // Login-specific logo overrides must not leak into sibling auth routes
    // that share AuthLayout (recover, signup, authorize).
    useEffect(() => {
        return () => setLogoSlot(null)
    }, [setLogoSlot])

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

    // Account chooser re-auth: when routed here with a login_hint, look the
    // account up once and advance straight to its password step.
    const hintLookupRef = useRef(false)
    if (loginHint && !hintLookupRef.current) {
        hintLookupRef.current = true
        queueMicrotask(() => { void runLookup(loginHint) })
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
            setBasePreset("oxy")
            setLookupResult(null)
            setLogoSlot(null)
        }
        setStepState({ step: next, direction: dir })
        requestAnimationFrame(() => {
            if (next === "password") passwordRef.current?.focus()
            else if (next === "identifier") identifierRef.current?.focus()
        })
    }

    function setAvatarAsLogo(avatar: string | null) {
        setLogoSlot(
            <Avatar
                source={avatar ? getAvatarUrl(avatar) : undefined}
                size={56}
            />
        )
    }

    /**
     * Look an account up by username, apply its color/avatar branding, and
     * advance to the password step. Shared by the manual identifier form and the
     * chooser's "re-auth a different signed-in account" path.
     */
    async function runLookup(username: string): Promise<void> {
        setLocalError(undefined)
        setIsSubmitting(true)
        try {
            const result = await oxy.lookupUsername(username)
            setLookupResult({
                username: result.username,
                displayName: result.name.displayName,
                avatar: result.avatar,
                color: result.color,
            })
            if (result.color) setBasePreset(result.color)
            setAvatarAsLogo(result.avatar)
            setIsSubmitting(false)
            goToStep("password", "forward")
        } catch (err) {
            setIsSubmitting(false)
            const status = (err as { status?: number; response?: { status?: number } } | undefined)?.status
                ?? (err as { response?: { status?: number } } | undefined)?.response?.status
            if (status === 429) {
                startRateLimitCountdown(60)
                setLocalError("Too many attempts. Please wait a minute and try again.")
                return
            }
            if (status === 404) {
                setLocalError("Couldn't find your account. Check your username and try again.")
                return
            }
            const message = err instanceof Error && err.message
                ? err.message
                : "Sign in is temporarily unavailable. Please try again."
            setLocalError(message)
        }
    }

    async function handleIdentifierSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        const username = identifier.trim()
        if (!username || rateLimitSeconds > 0) return
        await runLookup(username)
    }

    async function redirectAfterLogin(sessionId: string, authuser?: number) {
        // FedCM login_url completion: when there's no OAuth/cross-app request
        // context (no token, no redirect_uri), this login was almost certainly
        // initiated by the browser's FedCM flow opening our `login_url` dialog
        // (cold sign-in OR "use another account"). This branch MUST run before
        // any fire-and-forget login-status work: the `fedcm_session` cookie has
        // to land BEFORE we signal completion (so Chrome's accounts re-fetch
        // resolves the *new* account), and a stray `/fedcm/login-status` iframe
        // racing the `IdentityProvider.close()` handoff is exactly the kind of
        // concurrent navigation that made "use another account" complete
        // erratically. So we do a single AWAITED cookie write here and nothing
        // else, then hand off to the browser.
        if (!sessionToken && !redirectUri) {
            await registerFedCMSession(sessionId)
            if (completeFedCMLogin()) {
                return
            }
            // Not a FedCM browser-mediated context (e.g. a plain direct visit to /login):
            // the cookie is set; fall through to the normal redirect below.
        } else {
            // OAuth / cross-app login: keep the browser's FedCM login status in
            // sync (returning-account + silent SSO) via the fire-and-forget
            // cookie write + Set-Login iframe. Safe here because we are NOT in
            // the close()-handoff path.
            setFedCMLoginStatus(sessionId)
        }

        navigate(buildPostLoginRedirect({
            sessionToken,
            redirectUri,
            state,
            clientId,
            codeChallenge,
            codeChallengeMethod,
            scope,
            authuser,
        }))
    }

    function completeLogin(sessionId: string, authuser?: number, alert?: string) {
        if (alert) {
            setSecurityAlert(alert)
            setPendingRedirect({ sessionId, authuser })
            goToStep("security-alert", "forward")
            return
        }
        void redirectAfterLogin(sessionId, authuser)
    }

    async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLocalError(undefined)
        setIsSubmitting(true)

        const password = String(new FormData(e.currentTarget).get("password") || "")

        try {
            // Compute (or read cached) device fingerprint BEFORE the login
            // POST. The server uses it to dedupe device-local refresh-cookie
            // slots: a second sign-in from the same browser reuses an
            // existing `oxy_rt_${n}` slot instead of allocating a fresh
            // one, matching Google's multi-account model. Null is allowed —
            // the server treats a missing fingerprint as "no dedupe hint".
            const deviceFingerprint = await getOrCreateDeviceFingerprint()
            const body: Record<string, string> = {
                identifier: identifier.trim(),
                password,
            }
            if (deviceFingerprint) {
                body.deviceFingerprint = deviceFingerprint
            }
            const response = await fetch(buildAuthUrl("/login"), {
                method: "POST",
                headers: await withCsrfHeader({ "content-type": "application/json" }),
                credentials: "include",
                body: JSON.stringify(body),
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

            completeLogin(parsed.sessionId, parsed.authuser, payload.securityAlert)
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
                headers: await withCsrfHeader({ "content-type": "application/json" }),
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

            completeLogin(parsed.sessionId, parsed.authuser, payload.securityAlert)
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Unable to verify")
            setIsSubmitting(false)
        }
    }

    /**
     * Continue with an account already present in the refresh-cookie account
     * list. The chooser carries only its non-secret `authuser` slot forward so
     * `/authorize` can target the same account without storing a bearer.
     */
    async function continueWithCurrentAccount(entry: DeviceAccount): Promise<void> {
        setPendingSessionId(entry.sessionId)
        setIsSubmitting(true)
        try {
            await redirectAfterLogin(entry.sessionId, entry.authuser)
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Unable to continue")
            setPendingSessionId(null)
            setIsSubmitting(false)
        }
    }

    /**
     * Activate a sibling signed-in account WITHOUT a password. The only value
     * carried to `/authorize` is `authuser`, a device-local cookie slot index.
     * If a row has no indexed slot, it cannot be targeted cleanly and we ask for
     * explicit re-authentication.
     */
    async function activateSiblingAccount(entry: DeviceAccount): Promise<void> {
        if (typeof entry.authuser !== "number") {
            routeToReauth(entry)
            return
        }
        setPendingSessionId(entry.sessionId)
        setIsSubmitting(true)
        try {
            await redirectAfterLogin(entry.sessionId, entry.authuser)
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : "Unable to continue")
            setPendingSessionId(null)
            setIsSubmitting(false)
        }
    }

    /**
     * Reveal the sign-in form pre-filled for `entry`'s account so the user can
     * re-authenticate explicitly. Used only when a chosen account's session
     * cannot be activated silently. Clears any in-flight pending state so the
     * chooser row never spins while we transition to the password step.
     */
    function routeToReauth(entry: DeviceAccount): void {
        setPendingSessionId(null)
        setIsSubmitting(false)
        const hint = entry.account.username || entry.account.email
        if (hint) setIdentifier(hint)
        setShowLoginForm(true)
        if (entry.account.username) {
            void runLookup(entry.account.username)
        }
    }

    /**
     * A chooser row was selected. Google-style: EVERY signed-in account (active
     * OR a sibling slot) continues without a password. The password form is
     * reached only via "Use a different account" or when a slot can't be
     * targeted cleanly.
     */
    async function handleSelectAccount(entry: DeviceAccount): Promise<void> {
        if (entry.isCurrent) {
            await continueWithCurrentAccount(entry)
            return
        }
        await activateSiblingAccount(entry)
    }

    function handleUseDifferentAccount(): void {
        setIdentifier("")
        setShowLoginForm(true)
    }

    function handleSecurityAlertDismiss() {
        if (pendingRedirect) {
            void redirectAfterLogin(pendingRedirect.sessionId, pendingRedirect.authuser)
        }
    }

    // Resolve app context for OAuth flows
    const appContext = sessionToken ? "Sign in to continue" : "Use your Oxy account"

    if (isLoading) return <LoadingSpinner className={className} />

    if (accounts.length > 0 && currentSessionId && !showLoginForm) {
        return (
            <AccountChooser
                className={className}
                accounts={accounts}
                onSelectAccount={handleSelectAccount}
                onUseAnother={handleUseDifferentAccount}
                pendingSessionId={pendingSessionId}
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
                <div className="flex flex-col gap-4">
                    {/* Third option: cross-device "Sign in with Oxy" (QR). The user
                        approves in their Oxy app on their phone — no password here. */}
                    <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        className="w-full"
                        onClick={() => goToStep("commons", "forward")}
                    >
                        <QrCode className="size-4" />
                        Sign in with Oxy
                    </Button>
                    <SocialLoginButtons
                        sessionToken={sessionToken}
                        redirectUri={redirectUri}
                        state={state}
                        clientId={clientId}
                        codeChallenge={codeChallenge}
                        codeChallengeMethod={codeChallengeMethod}
                        scope={scope}
                    />
                </div>
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
                            <Button type="submit" size="lg" className="w-full" loading={isSubmitting} disabled={isSubmitting || rateLimitSeconds > 0}>
                                Next
                            </Button>
                        </Field>
                    </FieldGroup>
                </form>
            )}

            {/* Step 2: Password */}
            {step === "password" && (
                <form onSubmit={handlePasswordSubmit} key="password" className={animationClass}>
                    <FieldGroup>
                        <AuthFormHeader
                            title={`Welcome, ${(lookupResult?.displayName || identifier).split(" ")[0]}!`}
                            description={<span className="text-muted-foreground">@{identifier}</span>}
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
                            <Button type="button" variant="outline" size="lg" onClick={() => goToStep("identifier", "back")} className="shrink-0" aria-label="Go back">
                                <ArrowLeft className="size-4" />
                            </Button>
                            <Button type="submit" size="lg" className="flex-1 min-w-0" loading={isSubmitting} disabled={isSubmitting || rateLimitSeconds > 0}>
                                Sign in
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
                            <Button type="button" variant="outline" size="lg" onClick={() => { setOtpValue(""); setBackupCode(""); setLoginToken(""); goToStep("password", "back") }} className="shrink-0" aria-label="Go back">
                                <ArrowLeft className="size-4" />
                            </Button>
                            <Button type="submit" size="lg" className="flex-1 min-w-0" loading={isSubmitting} disabled={isSubmitting || rateLimitSeconds > 0}>
                                Verify
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

            {/* Step 5: "Sign in with Oxy" (QR / app-to-app handoff). Completes
                through the SAME `completeLogin` path as the password step. */}
            {step === "commons" && (
                <div key="commons" className={animationClass}>
                    <CommonsSignIn
                        oxyServices={oxy}
                        clientId={OXY_CLIENT_ID}
                        onAuthorized={(sessionId) => completeLogin(sessionId)}
                        onBack={() => goToStep("identifier", "back")}
                    />
                </div>
            )}
        </AuthFormLayout>
    )
}
