import { useState, useRef } from "react"
import { useNavigate, Link } from "react-router-dom"
import { toast } from "sonner"

import { buildAuthUrl } from "@/lib/oxy-api-client"
import { setFedCMLoginStatus, buildPostLoginRedirect } from "@/lib/auth-utils"
import { Button } from "@/components/ui/button"
import {
    Field,
    FieldError,
    FieldGroup,
    FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/password-input"
import { PasswordRequirements } from "@/components/password-requirements"
import { SocialLoginButtons } from "@/components/social-login-buttons"
import {
    AuthFormLayout,
    AuthFormHeader,
} from "@/components/auth-form-layout"
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
    const [localError, setLocalError] = useState<string | undefined>()
    const [serverErrors, setServerErrors] = useState<string[]>([])
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [password, setPassword] = useState("")
    const [passwordTouched, setPasswordTouched] = useState(false)

    const displayError = localError ?? error

    // Show error toast from URL param once
    const errorShownRef = useRef(false)
    if (error && !errorShownRef.current) {
        errorShownRef.current = true
        queueMicrotask(() => toast.error("Sign up failed", { description: error }))
    }

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
        setLocalError(undefined)
        setServerErrors([])
        setIsSubmitting(true)

        const formData = new FormData(event.currentTarget)
        const email = String(formData.get("email") || "").trim()
        const username = String(formData.get("username") || "").trim()

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
                    const msg = typeof payload?.message === "string"
                        ? payload.message
                        : "Unable to sign up"
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
            if (!didRedirect) {
                setIsSubmitting(false)
            }
        }
    }

    return (
        <AuthFormLayout
            className={className}
            footer={
                <SocialLoginButtons
                    sessionToken={sessionToken}
                    redirectUri={redirectUri}
                    state={state}
                />
            }
            {...props}
        >
            <form onSubmit={handleSubmit}>
                <FieldGroup>
                    <AuthFormHeader
                        title="Create your account"
                        description={
                            <>
                                Already have an account? <Link to="/login">Sign in</Link>
                            </>
                        }
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
                                if (password.length > 0) setPasswordTouched(true)
                            }}
                        />
                        {passwordTouched && <PasswordRequirements password={password} />}
                        {serverErrors.length > 0 && (
                            <FieldError errors={serverErrors.map((e) => ({ message: e }))} />
                        )}
                    </Field>
                    <Field>
                        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                            {isSubmitting ? "Creating account..." : "Sign Up"}
                        </Button>
                    </Field>
                </FieldGroup>
            </form>
        </AuthFormLayout>
    )
}
