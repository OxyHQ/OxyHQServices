import { useState, useRef, useCallback } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { Check, X, Loader2 } from "lucide-react"

import { buildAuthUrl, buildApiUrl } from "@/lib/oxy-api-client"
import { setFedCMLoginStatus, buildPostLoginRedirect } from "@/lib/auth-utils"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/password-input"
import { PasswordRequirements } from "@/components/password-requirements"
import { SocialLoginButtons } from "@/components/social-login-buttons"
import { AuthFormLayout, AuthFormHeader } from "@/components/auth-form-layout"
import { validatePassword } from "@/lib/password-validation"

type SignUpFormProps = React.ComponentProps<"div"> & {
    error?: string
    sessionToken?: string
    redirectUri?: string
    state?: string
}

type AvailabilityStatus = "idle" | "checking" | "available" | "taken"

function useAvailabilityCheck(endpoint: string) {
    const [status, setStatus] = useState<AvailabilityStatus>("idle")
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const controllerRef = useRef<AbortController | null>(null)

    const check = useCallback((value: string) => {
        if (timerRef.current) clearTimeout(timerRef.current)
        if (controllerRef.current) controllerRef.current.abort()

        if (!value || value.length < 3) {
            setStatus("idle")
            return
        }

        setStatus("checking")
        timerRef.current = setTimeout(async () => {
            controllerRef.current = new AbortController()
            try {
                const res = await fetch(
                    buildApiUrl(`${endpoint}/${encodeURIComponent(value)}`),
                    { signal: controllerRef.current.signal }
                )
                const data = await res.json().catch(() => ({}))
                setStatus(data?.data?.available ? "available" : "taken")
            } catch {
                // Aborted or network error — don't update status
            }
        }, 400)
    }, [endpoint])

    const reset = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current)
        if (controllerRef.current) controllerRef.current.abort()
        setStatus("idle")
    }, [])

    return { status, check, reset }
}

function AvailabilityIndicator({ status, takenMessage }: { status: AvailabilityStatus; takenMessage: string }) {
    if (status === "idle") return null
    if (status === "checking") return <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Checking...</span>
    if (status === "available") return <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1"><Check className="size-3" /> Available</span>
    return <span className="text-xs text-destructive flex items-center gap-1"><X className="size-3" /> {takenMessage}</span>
}

export function SignUpForm({
    className,
    error,
    sessionToken,
    redirectUri,
    state,
    ...props
}: SignUpFormProps) {
    const navigate = useNavigate()
    const [localError, setLocalError] = useState<string | undefined>()
    const [serverErrors, setServerErrors] = useState<string[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [password, setPassword] = useState("")
    const [passwordTouched, setPasswordTouched] = useState(false)

    const displayError = localError ?? error

    const username = useAvailabilityCheck("/auth/check-username")
    const email = useAvailabilityCheck("/auth/check-email")

    const errorShownRef = useRef(false)
    if (error && !errorShownRef.current) {
        errorShownRef.current = true
        queueMicrotask(() => toast.error("Sign up failed", { description: error }))
    }

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault()
        setLocalError(undefined)
        setServerErrors([])
        setIsSubmitting(true)

        const formData = new FormData(event.currentTarget)
        const emailValue = String(formData.get("email") || "").trim()
        const usernameValue = String(formData.get("username") || "").trim()

        const clientErrors = validatePassword(password)
        if (clientErrors.length > 0) {
            setPasswordTouched(true)
            setIsSubmitting(false)
            return
        }

        let didRedirect = false

        try {
            const response = await fetch(buildAuthUrl("/signup"), {
                method: "POST",
                headers: { "content-type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ email: emailValue, username: usernameValue, password }),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                if (response.status === 429) {
                    setLocalError("Too many attempts. Please try again later.")
                    setIsSubmitting(false)
                    return
                }
                const errors = Array.isArray(payload?.errors) ? (payload.errors as string[]) : []
                if (errors.length > 0) {
                    setServerErrors(errors)
                } else {
                    const msg = typeof payload?.message === "string" ? payload.message : "Unable to sign up"
                    setLocalError(msg)
                    toast.error("Sign up failed", { description: msg })
                }
                return
            }

            if (!payload?.sessionId) {
                setLocalError("Unable to sign up")
                return
            }

            setFedCMLoginStatus(payload.sessionId)
            didRedirect = true
            navigate(buildPostLoginRedirect({ sessionToken, redirectUri, state }))
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Unable to sign up"
            setLocalError(msg)
            toast.error("Sign up failed", { description: msg })
        } finally {
            if (!didRedirect) setIsSubmitting(false)
        }
    }

    return (
        <AuthFormLayout
            className={className}
            footer={<SocialLoginButtons sessionToken={sessionToken} redirectUri={redirectUri} state={state} />}
            {...props}
        >
            <form onSubmit={handleSubmit}>
                <FieldGroup>
                    <AuthFormHeader
                        title="Create your account"
                        description={<>Already have an account? <Link to="/login">Sign in</Link></>}
                    />
                    <Field>
                        <FieldLabel htmlFor="email">Email</FieldLabel>
                        <Input
                            id="email"
                            name="email"
                            type="email"
                            placeholder="m@example.com"
                            autoComplete="email"
                            required
                            onChange={(e) => email.check(e.target.value.trim())}
                        />
                        <AvailabilityIndicator status={email.status} takenMessage="This email is already registered" />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="username">Username</FieldLabel>
                        <Input
                            id="username"
                            name="username"
                            type="text"
                            placeholder="yourname"
                            autoComplete="username"
                            required
                            onChange={(e) => username.check(e.target.value.trim())}
                        />
                        <AvailabilityIndicator status={username.status} takenMessage="This username is taken" />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="password">Password</FieldLabel>
                        <PasswordInput
                            id="password"
                            name="password"
                            autoComplete="new-password"
                            required
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value)
                                setServerErrors([])
                                if (!passwordTouched && e.target.value.length > 0) setPasswordTouched(true)
                            }}
                            onBlur={() => { if (password.length > 0) setPasswordTouched(true) }}
                        />
                        {passwordTouched && <PasswordRequirements password={password} />}
                        {serverErrors.length > 0 && <FieldError errors={serverErrors.map((e) => ({ message: e }))} />}
                    </Field>
                    <Field>
                        <Button
                            type="submit"
                            size="lg"
                            className="w-full"
                            disabled={isSubmitting || username.status === "taken" || email.status === "taken"}
                        >
                            {isSubmitting ? "Creating account..." : "Sign Up"}
                        </Button>
                    </Field>
                </FieldGroup>
            </form>
        </AuthFormLayout>
    )
}
