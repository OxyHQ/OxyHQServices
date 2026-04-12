import { useState, useRef } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { CheckCircle2 } from "lucide-react"

import { buildAuthUrl } from "@/lib/oxy-api-client"
import { Button } from "@/components/ui/button"
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/password-input"
import { PasswordRequirements } from "@/components/password-requirements"
import {
    AuthFormLayout,
    AuthFormHeader,
} from "@/components/auth-form-layout"
import { validatePassword } from "@/lib/password-validation"

type RecoverFormProps = React.ComponentProps<"div"> & {
    error?: string
    step?: string
    identifier?: string
    devCode?: string
}

export function RecoverForm({
    className,
    error,
    step,
    identifier: initialIdentifier,
    devCode,
    ...props
}: RecoverFormProps) {
    const recoveryStorageKey = "oxy_recovery_token"
    const navigate = useNavigate()
    const currentStep = step === "verify" || step === "reset" || step === "success" ? step : "request"
    const [localError, setLocalError] = useState<string | undefined>()
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [identifierValue, setIdentifierValue] = useState(initialIdentifier || "")

    const [password, setPassword] = useState("")
    const [passwordTouched, setPasswordTouched] = useState(false)

    const displayError = localError ?? error

    // Show error toast from URL param once
    const errorShownRef = useRef(false)
    if (error && !errorShownRef.current) {
        errorShownRef.current = true
        queueMicrotask(() => toast.error("Recovery error", { description: error }))
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setLocalError(undefined)
        setIsSubmitting(true)

        const formData = new FormData(event.currentTarget)
        const stepValue = String(formData.get("step") || "request")
        const formIdentifier = String(formData.get("identifier") || "").trim()
        let didRedirect = false

        try {
            if (stepValue === "request") {
                const response = await fetch(buildAuthUrl("/recover/request"), {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({ identifier: formIdentifier }),
                })

                const payload = await response.json().catch(() => ({}))
                if (!response.ok) {
                    const message =
                        typeof payload?.message === "string"
                            ? payload.message
                            : "Unable to continue recovery"
                    setLocalError(message)
                    return
                }

                const nextUrl = new URL("/recover", window.location.origin)
                nextUrl.searchParams.set("step", "verify")
                if (formIdentifier) {
                    nextUrl.searchParams.set("identifier", formIdentifier)
                }
                if (payload?.devCode) {
                    nextUrl.searchParams.set("devCode", payload.devCode)
                }

                didRedirect = true
                navigate(`${nextUrl.pathname}${nextUrl.search}`)
                return
            }

            if (stepValue === "verify") {
                const code = String(formData.get("code") || "").trim()
                const response = await fetch(buildAuthUrl("/recover/verify"), {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({ identifier: formIdentifier, code }),
                })

                const payload = await response.json().catch(() => ({}))
                if (!response.ok) {
                    const message =
                        typeof payload?.message === "string"
                            ? payload.message
                            : "Unable to continue recovery"
                    setLocalError(message)
                    return
                }

                if (!payload?.recoveryToken) {
                    setLocalError("Unable to continue recovery")
                    return
                }

                sessionStorage.setItem(recoveryStorageKey, payload.recoveryToken)

                const nextUrl = new URL("/recover", window.location.origin)
                nextUrl.searchParams.set("step", "reset")
                if (formIdentifier) {
                    nextUrl.searchParams.set("identifier", formIdentifier)
                }

                didRedirect = true
                navigate(`${nextUrl.pathname}${nextUrl.search}`)
                return
            }

            if (stepValue === "reset") {
                // Client-side password validation
                const clientErrors = validatePassword(password)
                if (clientErrors.length > 0) {
                    setPasswordTouched(true)
                    setIsSubmitting(false)
                    return
                }

                const recoveryToken = sessionStorage.getItem(recoveryStorageKey)
                if (!recoveryToken) {
                    setLocalError(
                        "Recovery session expired. Please request a new code."
                    )
                    return
                }

                const response = await fetch(buildAuthUrl("/recover/reset"), {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    credentials: "include",
                    body: JSON.stringify({ recoveryToken, password }),
                })

                const payload = await response.json().catch(() => ({}))
                if (!response.ok) {
                    const message =
                        typeof payload?.message === "string"
                            ? payload.message
                            : "Unable to reset password"
                    setLocalError(message)
                    return
                }

                sessionStorage.removeItem(recoveryStorageKey)

                const nextUrl = new URL("/recover", window.location.origin)
                nextUrl.searchParams.set("step", "success")
                didRedirect = true
                navigate(`${nextUrl.pathname}${nextUrl.search}`)
                return
            }

            setLocalError("Unable to continue recovery")
        } catch (err) {
            setLocalError(
                err instanceof Error ? err.message : "Unable to continue recovery"
            )
        } finally {
            if (!didRedirect) {
                setIsSubmitting(false)
            }
        }
    }

    // Success screen
    if (currentStep === "success") {
        return (
            <AuthFormLayout className={className} {...props}>
                <div className="flex flex-col gap-4">
                    <CheckCircle2 className="size-12 text-green-600 dark:text-green-400" />
                    <h1 className="text-5xl font-extrabold tracking-tight font-display">Password reset successful</h1>
                    <FieldDescription className="text-lg">
                        Your password has been updated. You can now sign in with your new password.
                    </FieldDescription>
                    <Button asChild size="lg" className="w-full">
                        <Link to="/login">Sign in</Link>
                    </Button>
                </div>
            </AuthFormLayout>
        )
    }

    const stepDescriptions: Record<string, string> = {
        request: "Enter your email or username to receive a recovery code",
        verify: "Enter the recovery code we sent you",
        reset: "Set a new password for your account",
    }

    return (
        <AuthFormLayout
            className={className}
            {...props}
        >
            <form onSubmit={handleSubmit}>
                <FieldGroup>
                    <AuthFormHeader
                        title="Recover your account"
                        description={stepDescriptions[currentStep]}
                    />
                    {currentStep === "request" ? (
                        <>
                            <input type="hidden" name="step" value="request" />
                            <Field>
                                <FieldLabel htmlFor="identifier">Email or username</FieldLabel>
                                <Input
                                    id="identifier"
                                    name="identifier"
                                    type="text"
                                    placeholder="m@example.com"
                                    autoComplete="username"
                                    value={identifierValue}
                                    onChange={(e) => setIdentifierValue(e.target.value)}
                                    required
                                />
                            </Field>
                            <Field>
                                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                                    {isSubmitting ? "Sending..." : "Send Recovery Code"}
                                </Button>
                            </Field>
                        </>
                    ) : null}
                    {currentStep === "verify" ? (
                        <>
                            <input type="hidden" name="step" value="verify" />
                            <input type="hidden" name="identifier" value={initialIdentifier || ""} />
                            <Field>
                                <FieldLabel htmlFor="code">Recovery code</FieldLabel>
                                <Input
                                    id="code"
                                    name="code"
                                    type="text"
                                    placeholder="123456"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    required
                                />
                            </Field>
                            {devCode ? (
                                <FieldDescription>Dev code: {devCode}</FieldDescription>
                            ) : null}
                            <Field>
                                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                                    {isSubmitting ? "Verifying..." : "Verify Code"}
                                </Button>
                            </Field>
                        </>
                    ) : null}
                    {currentStep === "reset" ? (
                        <>
                            <input type="hidden" name="step" value="reset" />
                            <input type="hidden" name="identifier" value={initialIdentifier || ""} />
                            <Field>
                                <FieldLabel htmlFor="password">New password</FieldLabel>
                                <PasswordInput
                                    id="password"
                                    name="password"
                                    placeholder="New password"
                                    autoComplete="new-password"
                                    required
                                    value={password}
                                    onChange={(e) => {
                                        setPassword(e.target.value)
                                        if (!passwordTouched && e.target.value.length > 0) {
                                            setPasswordTouched(true)
                                        }
                                    }}
                                    onBlur={() => {
                                        if (password.length > 0) {
                                            setPasswordTouched(true)
                                        }
                                    }}
                                />
                                {passwordTouched && (
                                    <PasswordRequirements password={password} />
                                )}
                            </Field>
                            <Field>
                                <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                                    {isSubmitting ? "Resetting..." : "Reset Password"}
                                </Button>
                            </Field>
                        </>
                    ) : null}
                </FieldGroup>
            </form>
        </AuthFormLayout>
    )
}
