import { useEffect, useState } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"

import { buildAuthUrl } from "@/lib/oxy-api-client"
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
import { PasswordInput } from "@/components/password-input"
import { PasswordRequirements } from "@/components/password-requirements"
import { SocialLoginButtons } from "@/components/social-login-buttons"
import { Logo } from "@/components/logo"
import { validatePassword } from "@/lib/password-validation"

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
    const navigate = useNavigate()
    const [errorMessage, setErrorMessage] = useState(error)
    const [serverErrors, setServerErrors] = useState<string[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [password, setPassword] = useState("")
    const [passwordTouched, setPasswordTouched] = useState(false)
    const formAction = buildAuthUrl("/signup")

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
            const response = await fetch(buildAuthUrl("/signup"), {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                credentials: "include",
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

            // Set FedCM login status via iframe
            const loginStatusFrame = document.createElement("iframe")
            loginStatusFrame.style.display = "none"
            loginStatusFrame.src = "/fedcm/login-status"
            document.body.appendChild(loginStatusFrame)
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
            navigate(`${nextUrl.pathname}${nextUrl.search}`)
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
                            to="/login"
                            className="flex flex-col items-center gap-2 font-medium"
                        >
                            <Logo />
                            <span className="sr-only">Oxy</span>
                        </Link>
                        <h1 className="text-xl font-bold">Create your account</h1>
                        <FieldDescription>
                            Already have an account? <Link to="/login">Sign in</Link>
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
                        <PasswordInput
                            id="password"
                            name="password"
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
                        <Button type="submit" className="w-full" disabled={isSubmitting}>
                            {isSubmitting ? "Creating account..." : "Sign Up"}
                        </Button>
                    </Field>
                </FieldGroup>
            </form>
            <SocialLoginButtons
                sessionToken={sessionToken}
                redirectUri={redirectUri}
                state={state}
            />
            <FieldDescription className="px-6 text-center">
                By clicking continue, you agree to our{" "}
                <a href="https://oxy.so/company/transparency/policies/terms-of-service">Terms of Service</a> and <a href="https://oxy.so/company/transparency/policies/privacy">Privacy Policy</a>.
            </FieldDescription>
        </div>
    )
}
