import { useState, useRef, useEffect } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { ArrowLeft, QrCode, ShieldAlert } from "lucide-react"
import type { SwitchableAccount } from "@oxyhq/core"
import type { SecurityAlert } from "@oxyhq/contracts"
import { useOxy, useSwitchableAccounts } from "@oxyhq/services"
import { Avatar } from "@oxyhq/bloom/avatar"
import { getAvatarUrl } from "@/lib/oxy-api-client"
import { buildPostLoginRedirect } from "@/lib/auth-utils"
import { setBasePreset } from "@/lib/bloom-css"
import { useLayoutContext } from "@/lib/layout-context"
import { getOrCreateDeviceFingerprint } from "@/lib/device-fingerprint"
import { Button } from "@oxyhq/bloom/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/password-input"
import { AccountChooser } from "@/components/account-chooser"
import { SocialLoginButtons } from "@/components/social-login-buttons"
import { AuthFormLayout, AuthFormHeader, LoadingSpinner } from "@/components/auth-form-layout"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"

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

type LoginStep = "identifier" | "password" | "2fa" | "security-alert"

type LookupResult = {
    username: string
    displayName: string
    avatar: string | null
    color: string | null
}

/** Read an HTTP status off a thrown SDK error (ApiError-shaped or axios-shaped). */
function errorStatus(err: unknown): number | undefined {
    return (
        (err as { status?: number } | undefined)?.status ??
        (err as { response?: { status?: number } } | undefined)?.response?.status
    )
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
    const signupPath = (() => {
        const params = new URLSearchParams()
        if (sessionToken) params.set("token", sessionToken)
        if (redirectUri) params.set("redirect_uri", redirectUri)
        if (state) params.set("state", state)
        if (clientId) params.set("client_id", clientId)
        if (codeChallenge) params.set("code_challenge", codeChallenge)
        if (codeChallengeMethod) params.set("code_challenge_method", codeChallengeMethod)
        if (scope) params.set("scope", scope)
        const qs = params.toString()
        return qs ? `/signup?${qs}` : "/signup"
    })()
    // The IdP authenticates through the SAME device-first SDK path every Oxy app
    // uses: `signInWithPassword` / `completeTwoFactorSignIn` verify credentials,
    // persist the zero-cookie `{deviceId, deviceSecret}` credential, plant the
    // access token, and register the account into the device set. There is NO
    // bespoke login fetch or first-party device cookie anymore. "Sign in with
    // Oxy" opens the shared services OxyAccountDialog (QR / Commons device-flow
    // handoff) mounted by the OxyProvider at the app root.
    const {
        oxyServices,
        signInWithPassword,
        completeTwoFactorSignIn,
        revokeSuspiciousSignIn,
        switchToAccount,
        openAccountDialog,
    } = useOxy()
    const { setLogoSlot } = useLayoutContext()

    const [localError, setLocalError] = useState<string | undefined>()
    const [rateLimitSeconds, setRateLimitSeconds] = useState(0)
    const displayError = rateLimitSeconds > 0 ? `Too many attempts. Try again in ${rateLimitSeconds}s.` : (localError ?? error)

    const [isSubmitting, setIsSubmitting] = useState(false)
    const [pendingAccountId, setPendingAccountId] = useState<string | null>(null)
    // When a login_hint is supplied (the chooser routed a non-active account
    // here for re-auth), bypass the chooser and go straight to the sign-in form.
    const [showLoginForm, setShowLoginForm] = useState(Boolean(loginHint))

    // Every account signed in on this device (1..N) — the same device-first SDK
    // projection every Oxy app renders. The chooser is shown as an additive front
    // screen whenever at least one account is present and the user hasn't opted
    // into "Use a different account".
    const { isLoading, currentSessionId, accounts } = useSwitchableAccounts()

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
    // The server-flagged "New sign-in detected" alert (new device / location),
    // shown as an interstitial after a committed sign-in before continuing to
    // the OAuth authorize step. Null when the sign-in was unremarkable.
    const [securityAlert, setSecurityAlert] = useState<SecurityAlert | null>(null)

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
            const result = await oxyServices.lookupUsername(username)
            setLookupResult({
                username: result.username,
                // `name.displayName` is optional on the contract — fall back to
                // the username handle when the account has no display name.
                displayName: result.name.displayName ?? result.username,
                avatar: result.avatar,
                color: result.color,
            })
            if (result.color) setBasePreset(result.color)
            setAvatarAsLogo(result.avatar)
            setIsSubmitting(false)
            goToStep("password", "forward")
        } catch (err) {
            setIsSubmitting(false)
            const status = errorStatus(err)
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

    function redirectAfterLogin() {
        // The device-first session is already committed by the SDK funnel (token
        // planted, `{deviceId, deviceSecret}` persisted, account registered as
        // the active device account), so there is nothing to plant here — proceed
        // straight to `/authorize`, which targets the SDK's active account.
        navigate(buildPostLoginRedirect({
            sessionToken,
            redirectUri,
            state,
            clientId,
            codeChallenge,
            codeChallengeMethod,
            scope,
        }))
    }

    /**
     * A device-first sign-in (password or 2FA) has already committed the session.
     * If the server flagged it as anomalous, show the "New sign-in detected"
     * acknowledgement first; otherwise continue straight to the OAuth authorize
     * step. Covers BOTH the one-step and 2FA paths.
     */
    function proceedAfterSignIn(alert?: SecurityAlert) {
        if (alert) {
            setSecurityAlert(alert)
            setIsSubmitting(false)
            goToStep("security-alert", "forward")
            return
        }
        redirectAfterLogin()
    }

    /**
     * "That wasn't me": the just-committed sign-in was flagged as anomalous and
     * the user is repudiating it. Revoke the device session server-side and clear
     * the local zero-cookie device credential via the SDK (no app-local auth
     * plumbing), then return to the identifier step. Revocation failure is
     * non-fatal — we still drop the alert and bounce back so the compromised UI
     * never lingers.
     */
    async function handleDenySignIn() {
        setIsSubmitting(true)
        try {
            await revokeSuspiciousSignIn()
        } catch (err) {
            const message = err instanceof Error && err.message ? err.message : "Couldn't revoke that sign-in."
            toast.error("Revoke failed", { description: message })
        } finally {
            setSecurityAlert(null)
            setIsSubmitting(false)
            // Re-show the identifier form rather than the account chooser: the
            // repudiated account was just revoked, so returning to the chooser
            // would be confusing.
            setShowLoginForm(true)
            goToStep("identifier", "back")
        }
    }

    /** Map a thrown sign-in error onto the inline error UI (rate-limit aware). */
    function handleSignInError(err: unknown, fallback: string) {
        const status = errorStatus(err)
        if (status === 429) {
            startRateLimitCountdown(60)
            setLocalError("Too many attempts. Please wait a minute and try again.")
            return
        }
        const message = err instanceof Error && err.message ? err.message : fallback
        setLocalError(message)
        toast.error("Sign in failed", { description: message })
    }

    async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLocalError(undefined)
        setIsSubmitting(true)

        const password = String(new FormData(e.currentTarget).get("password") || "")

        try {
            // Compute (or read cached) device fingerprint BEFORE the sign-in call.
            // The server uses it to dedupe device-local account slots: a second
            // sign-in from the same browser reuses an existing device-account slot
            // instead of allocating a fresh one, matching Google's multi-account
            // model. Null is allowed — the server treats a missing fingerprint as
            // "no dedupe hint".
            const deviceFingerprint = await getOrCreateDeviceFingerprint()
            const result = await signInWithPassword(identifier.trim(), password, {
                deviceFingerprint: deviceFingerprint ?? undefined,
            })

            if (result.status === "2fa_required") {
                setLoginToken(result.loginToken)
                setIsSubmitting(false)
                goToStep("2fa", "forward")
                return
            }

            proceedAfterSignIn(result.securityAlert)
        } catch (err) {
            handleSignInError(err, "Unable to sign in")
            setIsSubmitting(false)
        }
    }

    async function handle2FASubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault()
        setLocalError(undefined)
        setIsSubmitting(true)

        try {
            const { securityAlert: alert } = await completeTwoFactorSignIn({
                loginToken,
                token: useBackupCode ? undefined : otpValue,
                backupCode: useBackupCode ? backupCode.trim() : undefined,
            })
            proceedAfterSignIn(alert)
        } catch (err) {
            const status = errorStatus(err)
            if (status === 429) {
                startRateLimitCountdown(60)
                setLocalError("Too many attempts. Please wait a minute and try again.")
            } else {
                const message = err instanceof Error && err.message ? err.message : "Unable to verify"
                setLocalError(message)
                toast.error("Verification failed", { description: message })
            }
            setIsSubmitting(false)
        }
    }

    /**
     * Reveal the sign-in form pre-filled for `entry`'s account so the user can
     * re-authenticate explicitly. Used when a chosen account cannot be switched
     * into silently. Clears any in-flight pending state so the chooser row never
     * spins while we transition to the password step.
     */
    function routeToReauth(entry: SwitchableAccount): void {
        setPendingAccountId(null)
        setIsSubmitting(false)
        const hint = entry.user.username ?? undefined
        if (hint) {
            setIdentifier(hint)
            setShowLoginForm(true)
            void runLookup(hint)
        } else {
            setShowLoginForm(true)
        }
    }

    /**
     * A chooser row was selected. Google-style: EVERY signed-in account continues
     * without a password. The active account proceeds straight to `/authorize`;
     * any sibling is switched into first (the uniform device-first switch), then
     * `/authorize` targets it. A switch failure falls back to explicit re-auth.
     */
    async function handleSelectAccount(entry: SwitchableAccount): Promise<void> {
        setPendingAccountId(entry.accountId)
        setIsSubmitting(true)
        try {
            if (!entry.isCurrent) {
                await switchToAccount(entry.accountId)
            }
            redirectAfterLogin()
        } catch {
            routeToReauth(entry)
        }
    }

    function handleUseDifferentAccount(): void {
        setIdentifier("")
        setShowLoginForm(true)
    }

    // Resolve app context for OAuth flows
    const appContext = sessionToken ? "Sign in to continue" : "Use your Oxy account"

    if (isLoading) return <LoadingSpinner className={className} />

    // The chooser is the INITIAL front screen (returning device). Gate it on the
    // identifier step so the reactive `useSwitchableAccounts` update that fires
    // once a sign-in commits (the just-created account appears on the device)
    // cannot re-mask a later step — notably the "New sign-in detected" alert.
    if (step === "identifier" && accounts.length > 0 && currentSessionId && !showLoginForm) {
        return (
            <AccountChooser
                className={className}
                accounts={accounts}
                onSelectAccount={handleSelectAccount}
                onUseAnother={handleUseDifferentAccount}
                pendingAccountId={pendingAccountId}
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
                        onClick={() => openAccountDialog("signin")}
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
                            <Link to={signupPath}>Create account</Link>
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

            {/* Step 4: Security alert (new device, unusual location, etc.). The
                session is ALREADY committed device-first — this is an
                acknowledgement interstitial before continuing to OAuth authorize. */}
            {step === "security-alert" && (
                <div key="security-alert" className={animationClass}>
                    <FieldGroup>
                        <div className="flex flex-col items-center gap-4 text-center">
                            <div className="size-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                <ShieldAlert className="size-8 text-amber-600 dark:text-amber-400" />
                            </div>
                            <h1 className="text-3xl font-extrabold tracking-tight">New sign-in detected</h1>
                            <p className="text-base text-muted-foreground">{securityAlert?.message}</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <Button variant="outline" size="lg" className="flex-1" loading={isSubmitting} disabled={isSubmitting} onClick={() => { void handleDenySignIn() }}>
                                That wasn&apos;t me
                            </Button>
                            <Button size="lg" className="flex-1" disabled={isSubmitting} onClick={() => redirectAfterLogin()}>
                                Yes, it was me
                            </Button>
                        </div>
                    </FieldGroup>
                </div>
            )}

        </AuthFormLayout>
    )
}
