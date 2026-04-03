import { useEffect, useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"
import { CheckCircle2 } from "lucide-react"

import { buildAuthUrl } from "@/lib/oxy-api-client"
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
import { PasswordRequirements } from "@/components/password-requirements"
import { Logo } from "@/components/logo"
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
    const [errorMessage, setErrorMessage] = useState(error)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [identifierValue, setIdentifierValue] = useState(initialIdentifier || "")

    // Password validation state for reset step
    const [password, setPassword] = useState("")
    const [passwordTouched, setPasswordTouched] = useState(false)

    useEffect(() => {
        setErrorMessage(error)
    }, [error])

    useEffect(() => {
        if (errorMessage) {
            toast.error("Recovery error", { description: errorMessage })
        }
    }, [errorMessage])

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setErrorMessage(undefined)
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
                    setErrorMessage(message)
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
                    setErrorMessage(message)
                    return
                }

                if (!payload?.recoveryToken) {
                    setErrorMessage("Unable to continue recovery")
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
                    setErrorMessage(
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
                    setErrorMessage(message)
                    return
                }

                sessionStorage.removeItem(recoveryStorageKey)

                const nextUrl = new URL("/recover", window.location.origin)
                nextUrl.searchParams.set("step", "success")
                didRedirect = true
                navigate(`${nextUrl.pathname}${nextUrl.search}`)
                return
            }

            setErrorMessage("Unable to continue recovery")
        } catch (err) {
            setErrorMessage(
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
            <div className={cn("flex flex-col gap-6", className)} {...props}>
                <div className="flex flex-col items-center gap-4 text-center">
                    <Logo />
                    <CheckCircle2 className="size-12 text-green-600 dark:text-green-400" />
                    <h1 className="text-xl font-bold">Password reset successful</h1>
                    <FieldDescription>
                        Your password has been updated. You can now sign in with your new password.
                    </FieldDescription>
                    <Button asChild className="w-full">
                        <Link to="/login">Sign in</Link>
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <form onSubmit={handleSubmit}>
                <FieldGroup>
                    <div className="flex flex-col items-center gap-2 text-center">
                        <Link
                            to="/login"
                            className="flex flex-col items-center gap-2 font-medium"
                        >
                            <Logo />
                            <span className="sr-only">Oxy</span>
                        </Link>
                        <h1 className="text-xl font-bold">Recover your account</h1>
                        <FieldDescription>
                            {currentStep === "request"
                                ? "Enter your email or username to receive a recovery code"
                                : currentStep === "verify"
                                    ? "Enter the recovery code we sent you"
                                    : "Set a new password for your account"}
                        </FieldDescription>
                    </div>
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
                                <Button type="submit" className="w-full" disabled={isSubmitting}>
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
                                <Button type="submit" className="w-full" disabled={isSubmitting}>
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
                                <Button type="submit" className="w-full" disabled={isSubmitting}>
                                    {isSubmitting ? "Resetting..." : "Reset Password"}
                                </Button>
                            </Field>
                        </>
                    ) : null}
                </FieldGroup>
            </form>
            <FieldDescription className="px-6 text-center">
                By clicking continue, you agree to our{" "}
                <a href="https://oxy.so/company/transparency/policies/terms-of-service">Terms of Service</a> and{" "}
                <a href="https://oxy.so/company/transparency/policies/privacy">Privacy Policy</a>.
            </FieldDescription>
        </div>
    )
}
