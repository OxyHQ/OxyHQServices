import { useMemo } from "react"
import { Button } from "@/components/ui/button"

type SocialLoginButtonsProps = {
    sessionToken?: string
    redirectUri?: string
    state?: string
}

type Provider = {
    id: string
    name: string
    clientId: string
    icon: React.ReactNode
    variant: "outline" | "default"
    className?: string
    buildUrl: (params: { clientId: string; redirectUri: string; state: string }) => string
}

function GoogleIcon() {
    return (
        <svg viewBox="0 0 24 24" className="size-5">
            <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
            />
            <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
            />
            <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
            />
            <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
            />
        </svg>
    )
}

function AppleIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
            <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
        </svg>
    )
}

function GitHubIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className="size-5">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z" />
        </svg>
    )
}

function buildOAuthState(
    provider: string,
    params: { sessionToken?: string; redirectUri?: string; state?: string }
): string {
    return btoa(
        JSON.stringify({
            provider,
            sessionToken: params.sessionToken || "",
            redirectUri: params.redirectUri || "",
            state: params.state || "",
        })
    )
}

export function SocialLoginButtons({
    sessionToken,
    redirectUri,
    state,
}: SocialLoginButtonsProps) {
    const providers = useMemo(() => {
        const list: Provider[] = []

        const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
        const appleClientId = import.meta.env.VITE_APPLE_CLIENT_ID
        const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID

        if (googleClientId) {
            list.push({
                id: "google",
                name: "Google",
                clientId: googleClientId,
                icon: <GoogleIcon />,
                variant: "outline",
                buildUrl: ({ clientId, redirectUri, state }) => {
                    const params = new URLSearchParams({
                        client_id: clientId,
                        redirect_uri: redirectUri,
                        response_type: "code",
                        scope: "openid email profile",
                        state,
                    })
                    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`
                },
            })
        }

        if (appleClientId) {
            list.push({
                id: "apple",
                name: "Apple",
                clientId: appleClientId,
                icon: <AppleIcon />,
                variant: "outline",
                className: "dark:bg-white dark:text-black dark:hover:bg-white/90",
                buildUrl: ({ clientId, redirectUri, state }) => {
                    const params = new URLSearchParams({
                        client_id: clientId,
                        redirect_uri: redirectUri,
                        response_type: "code id_token",
                        scope: "name email",
                        response_mode: "form_post",
                        state,
                    })
                    return `https://appleid.apple.com/auth/authorize?${params}`
                },
            })
        }

        if (githubClientId) {
            list.push({
                id: "github",
                name: "GitHub",
                clientId: githubClientId,
                icon: <GitHubIcon />,
                variant: "outline",
                buildUrl: ({ clientId, redirectUri, state }) => {
                    const params = new URLSearchParams({
                        client_id: clientId,
                        redirect_uri: redirectUri,
                        scope: "user:email",
                        state,
                    })
                    return `https://github.com/login/oauth/authorize?${params}`
                },
            })
        }

        return list
    }, [])

    if (providers.length === 0) {
        return null
    }

    const callbackUri =
        typeof window !== "undefined"
            ? `${window.location.origin}/auth/social/callback`
            : ""

    return (
        <div className="flex flex-col gap-4">
            <div className="relative text-center text-sm">
                <span className="bg-background px-2 text-muted-foreground relative z-10">
                    Or continue with
                </span>
                <div className="absolute inset-0 top-1/2 border-t" />
            </div>
            <div className="flex flex-col gap-2">
                {providers.map((provider) => {
                    const oauthState = buildOAuthState(provider.id, {
                        sessionToken,
                        redirectUri,
                        state,
                    })
                    const href = callbackUri
                        ? provider.buildUrl({
                              clientId: provider.clientId,
                              redirectUri: callbackUri,
                              state: oauthState,
                          })
                        : "#"

                    return (
                        <Button
                            key={provider.id}
                            variant={provider.variant}
                            size="lg"
                            className={provider.className}
                            asChild
                        >
                            <a href={href}>
                                {provider.icon}
                                Continue with {provider.name}
                            </a>
                        </Button>
                    )
                })}
            </div>
        </div>
    )
}
