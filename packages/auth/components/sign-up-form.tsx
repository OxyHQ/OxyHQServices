
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
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Logo } from "@/components/logo"

const PASSWORD_RULES = [
    { test: (pw: string) => pw.length >= 12, label: "At least 12 characters" },
    { test: (pw: string) => /[A-Z]/.test(pw), label: "One uppercase letter (A-Z)" },
    { test: (pw: string) => /[a-z]/.test(pw), label: "One lowercase letter (a-z)" },
    { test: (pw: string) => /[0-9]/.test(pw), label: "One number (0-9)" },
    { test: (pw: string) => /[^A-Za-z0-9]/.test(pw), label: "One special character" },
]

function validatePassword(pw: string): string[] {
    return PASSWORD_RULES.filter((rule) => !rule.test(pw)).map((rule) => rule.label)
}

function PasswordRequirements({ password }: { password: string }) {
    return (
        <ul className="mt-1.5 space-y-1 text-xs">
            {PASSWORD_RULES.map((rule) => {
                const passes = rule.test(password)
                return (
                    <li
                        key={rule.label}
                        className={cn(
                            "flex items-center gap-1.5",
                            passes
                                ? "text-green-600 dark:text-green-400"
                                : "text-muted-foreground"
                        )}
                    >
                        {passes ? (
                            <svg
                                className="h-3 w-3 shrink-0"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                            >
                                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                            </svg>
                        ) : (
                            <svg
                                className="h-3 w-3 shrink-0"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                            >
                                <circle cx="8" cy="8" r="3" />
                            </svg>
                        )}
                        {rule.label}
                    </li>
                )
            })}
        </ul>
    )
}

type SignUpFormProps = React.ComponentProps<"div"> & {
    error?: string
    sessionToken?: string
    redirectUri?: string
    state?: string
}

export function SignUpForm({
    className,
    error,
    sessionToken,
    redirectUri,
    state,
    ...props
}: SignUpFormProps) {
    const router = useRouter()
    const [errorMessage, setErrorMessage] = useState(error)
    const [serverErrors, setServerErrors] = useState<string[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [password, setPassword] = useState("")
    const [passwordTouched, setPasswordTouched] = useState(false)
    const formAction = "/api/auth/signup"

    useEffect(() => {
        setErrorMessage(error)
    }, [error])

    useEffect(() => {
        if (errorMessage) {
            toast.error("Sign up failed", { description: errorMessage })
        }
    }, [errorMessage])

    const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value
        setPassword(value)
        setServerErrors([])
        if (!passwordTouched && value.length > 0) {
            setPasswordTouched(true)
        }
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setErrorMessage(undefined)
        setServerErrors([])
        setIsSubmitting(true)

        const formData = new FormData(event.currentTarget)
        const email = String(formData.get("email") || "").trim()
        const username = String(formData.get("username") || "").trim()

        // Client-side password validation
        const clientErrors = validatePassword(password)
        if (clientErrors.length > 0) {
            setPasswordTouched(true)
            setIsSubmitting(false)
            return
        }

        let didRedirect = false

        try {
            const response = await fetch("/api/auth/signup", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({ email, username, password }),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                const errors = Array.isArray(payload?.errors)
                    ? (payload.errors as string[])
                    : []
                if (errors.length > 0) {
                    setServerErrors(errors)
                } else {
                    const message =
                        typeof payload?.message === "string"
                            ? payload.message
                            : "Unable to sign up"
                    setErrorMessage(message)
                }
                return
            }

            if (!payload?.sessionId) {
                setErrorMessage("Unable to sign up")
                return
            }

            // Session cookie is now set server-side with httpOnly flag
            // by the /api/auth/signup route handler (Set-Cookie response header).

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
                err instanceof Error ? err.message : "Unable to sign up"
            )
        } finally {
            if (!didRedirect) {
                setIsSubmitting(false)
            }
        }
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
                        <Link
                            href="/login"
                            className="flex flex-col items-center gap-2 font-medium"
                        >
                            <Logo />
                            <span className="sr-only">Oxy</span>
                        </Link>
                        <h1 className="text-xl font-bold">Create your account</h1>
                        <FieldDescription>
                            Already have an account? <Link href="/login">Login</Link>
                        </FieldDescription>
                    </div>
                    <Field>
                        <FieldLabel htmlFor="email">Email</FieldLabel>
                        <Input
                            id="email"
                            name="email"
                            type="email"
                            placeholder="m@example.com"
                            autoComplete="email"
                            required
                        />
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
                        />
                    </Field>
                    <Field>
                        <FieldLabel htmlFor="password">Password</FieldLabel>
                        <Input
                            id="password"
                            name="password"
                            type="password"
                            autoComplete="new-password"
                            required
                            value={password}
                            onChange={handlePasswordChange}
                            onBlur={() => {
                                if (password.length > 0) {
                                    setPasswordTouched(true)
                                }
                            }}
                        />
                        {passwordTouched && (
                            <PasswordRequirements password={password} />
                        )}
                        {serverErrors.length > 0 && (
                            <FieldError
                                errors={serverErrors.map((e) => ({ message: e }))}
                            />
                        )}
                    </Field>
                    <Field>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Creating account..." : "Sign Up"}
                        </Button>
                    </Field>
                </FieldGroup>
            </form>
            <FieldDescription className="px-6 text-center">
                By clicking continue, you agree to our{" "}
                <a href="https://oxy.so/company/transparency/policies/terms-of-service">Terms of Service</a> and <a href="https://oxy.so/company/transparency/policies/privacy">Privacy Policy</a>.
            </FieldDescription>
        </div>
    )
}
