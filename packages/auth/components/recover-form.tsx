
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
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
import { Logo } from "@/components/logo"

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
    identifier,
    devCode,
    ...props
}: RecoverFormProps) {
    const recoveryStorageKey = "oxy_recovery_token"
    const router = useRouter()
    const currentStep = step === "verify" || step === "reset" ? step : "request"
    const [errorMessage, setErrorMessage] = useState(error)
    const [isSubmitting, setIsSubmitting] = useState(false)

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
        const identifierValue = String(formData.get("identifier") || "").trim()
        let didRedirect = false

        try {
            if (stepValue === "request") {
                const response = await fetch("/api/auth/recover/request", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({ identifier: identifierValue }),
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
                if (identifierValue) {
                    nextUrl.searchParams.set("identifier", identifierValue)
                }
                if (payload?.devCode) {
                    nextUrl.searchParams.set("devCode", payload.devCode)
                }

                didRedirect = true
                router.push(`${nextUrl.pathname}${nextUrl.search}`)
                return
            }

            if (stepValue === "verify") {
                const code = String(formData.get("code") || "").trim()
                const response = await fetch("/api/auth/recover/verify", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
                    body: JSON.stringify({ identifier: identifierValue, code }),
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
                if (identifierValue) {
                    nextUrl.searchParams.set("identifier", identifierValue)
                }

                didRedirect = true
                router.push(`${nextUrl.pathname}${nextUrl.search}`)
                return
            }

            if (stepValue === "reset") {
                const password = String(formData.get("password") || "")
                const recoveryToken = sessionStorage.getItem(recoveryStorageKey)
                if (!recoveryToken) {
                    setErrorMessage(
                        "Recovery session expired. Please request a new code."
                    )
                    return
                }

                const response = await fetch("/api/auth/recover/reset", {
                    method: "POST",
                    headers: {
                        "content-type": "application/json",
                    },
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
                didRedirect = true
                router.push("/login?reset=1")
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

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <form method="post" action="/api/auth/recover" onSubmit={handleSubmit}>
                <FieldGroup>
                    <div className="flex flex-col items-center gap-2 text-center">
                        <Link
                            href="/login"
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
                                    required
                                />
                            </Field>
                            <Field>
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? "Sending..." : "Send Recovery Code"}
                                </Button>
                            </Field>
                        </>
                    ) : null}
                    {currentStep === "verify" ? (
                        <>
                            <input type="hidden" name="step" value="verify" />
                            <input type="hidden" name="identifier" value={identifier || ""} />
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
                                <Button type="submit" disabled={isSubmitting}>
                                    {isSubmitting ? "Verifying..." : "Verify Code"}
                                </Button>
                            </Field>
                        </>
                    ) : null}
                    {currentStep === "reset" ? (
                        <>
                            <input type="hidden" name="step" value="reset" />
                            <input type="hidden" name="identifier" value={identifier || ""} />
                            <Field>
                                <FieldLabel htmlFor="password">New password</FieldLabel>
                                <Input
                                    id="password"
                                    name="password"
                                    type="password"
                                    placeholder="password"
                                    autoComplete="new-password"
                                    required
                                />
                            </Field>
                            <Field>
                                <Button type="submit" disabled={isSubmitting}>
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
