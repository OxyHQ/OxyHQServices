"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { GalleryVerticalEnd } from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Field,
    FieldDescription,
    FieldGroup,
    FieldLabel,
    FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type LoginFormProps = React.ComponentProps<"div"> & {
    error?: string
    notice?: string
    sessionToken?: string
    redirectUri?: string
    state?: string
}

export function LoginForm({
    className,
    error,
    notice,
    sessionToken,
    redirectUri,
    state,
    ...props
}: LoginFormProps) {
    const router = useRouter()
    const [errorMessage, setErrorMessage] = useState(error)
    const [noticeMessage, setNoticeMessage] = useState(notice)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const formAction = "/api/auth/login"

    useEffect(() => {
        setErrorMessage(error)
    }, [error])

    useEffect(() => {
        setNoticeMessage(notice)
    }, [notice])

    useEffect(() => {
        if (noticeMessage) {
            toast("Notice", { description: noticeMessage })
        }
    }, [noticeMessage])

    useEffect(() => {
        if (errorMessage) {
            toast.error("Sign in failed", { description: errorMessage })
        }
    }, [errorMessage])

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setErrorMessage(undefined)
        setNoticeMessage(undefined)
        setIsSubmitting(true)

        const formData = new FormData(event.currentTarget)
        const identifier = String(formData.get("identifier") || "").trim()
        const password = String(formData.get("password") || "")
        let didRedirect = false

        try {
            const response = await fetch("/api/auth/login", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body: JSON.stringify({ identifier, password }),
            })
            const payload = await response.json().catch(() => ({}))

            if (!response.ok) {
                const message =
                    typeof payload?.message === "string"
                        ? payload.message
                        : "Unable to sign in"
                setErrorMessage(message)
                return
            }

            if (!payload?.sessionId) {
                setErrorMessage("Unable to sign in")
                return
            }

            const cookieParts = [`oxy_session_id=${payload.sessionId}`, "path=/", "samesite=lax"]
            if (payload.expiresAt) {
                const expiresAt = new Date(payload.expiresAt).toUTCString()
                cookieParts.push(`expires=${expiresAt}`)
            }
            if (window.location.protocol === "https:") {
                cookieParts.push("secure")
            }
            document.cookie = cookieParts.join("; ")

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
                err instanceof Error ? err.message : "Unable to sign in"
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
                        <a
                            href="#"
                            className="flex flex-col items-center gap-2 font-medium"
                        >
                            <div className="flex size-8 items-center justify-center rounded-md">
                                <GalleryVerticalEnd className="size-6" />
                            </div>
                            <span className="sr-only">Acme Inc.</span>
                        </a>
                        <h1 className="text-xl font-bold">Welcome to Acme Inc.</h1>
                        <FieldDescription>
                            Don&apos;t have an account? <a href="/signup">Sign up</a>
                        </FieldDescription>
                    </div>
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
                        <FieldLabel htmlFor="password">Password</FieldLabel>
                        <Input
                            id="password"
                            name="password"
                            type="password"
                            placeholder="password"
                            autoComplete="current-password"
                            required
                        />
                    </Field>
                    <Field>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? "Signing in..." : "Login"}
                        </Button>
                    </Field>
                    <FieldSeparator>Or</FieldSeparator>
                    <Field className="grid gap-4 sm:grid-cols-2">
                        <Button variant="outline" type="button">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path
                                    d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
                                    fill="currentColor"
                                />
                            </svg>
                            Continue with Apple
                        </Button>
                        <Button variant="outline" type="button">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                                <path
                                    d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                                    fill="currentColor"
                                />
                            </svg>
                            Continue with Google
                        </Button>
                    </Field>
                </FieldGroup>
            </form>
            <FieldDescription className="px-6 text-center">
                By clicking continue, you agree to our <a href="#">Terms of Service</a>{" "}
                and <a href="#">Privacy Policy</a>.
            </FieldDescription>
        </div>
    )
}
