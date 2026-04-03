import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { Check, Shield } from "lucide-react"

import { Button } from "@/components/ui/button"
import { FieldDescription } from "@/components/ui/field"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar } from "@/components/ui/avatar"
import { ToastMessage } from "@/components/toast-message"
import { Empty, EmptyActions, EmptyDescription, EmptyTitle } from "@/components/ui/empty"
import { Logo } from "@/components/logo"
import {
    apiGet,
    buildRelativeUrl,
    getAvatarUrl,
    SESSION_COOKIE_NAME,
    safeRedirectUrl,
} from "@/lib/oxy-api"

type AuthorizePageProps = {
    searchParams?:
        | Record<string, string | string[] | undefined>
        | Promise<Record<string, string | string[] | undefined>>
}

type SessionStatus = {
    status: string
    appId?: string
    expiresAt?: string
    sessionId?: string | null
}

type TokenResponse = {
    accessToken: string
    expiresAt: string
}

type UserInfo = {
    id: string
    username?: string
    email?: string
    avatar?: string
    name?: {
        first?: string
        last?: string
    }
}

function getParam(
    params: Record<string, string | string[] | undefined> | undefined,
    key: string
) {
    const value = params?.[key]
    return typeof value === "string" ? value : undefined
}

function getInitials(name: string): string {
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
}

function getDisplayName(user: UserInfo): string {
    if (user.name?.first && user.name?.last) {
        return `${user.name.first} ${user.name.last}`
    }
    return user.username || user.email || "User"
}

async function fetchCurrentUser(sessionId: string): Promise<UserInfo | null> {
    try {
        return await apiGet<UserInfo>(`/session/user/${sessionId}`)
    } catch {
        return null
    }
}

export default async function AuthorizePage({ searchParams }: AuthorizePageProps) {
    const resolvedSearchParams = searchParams
        ? await Promise.resolve(searchParams)
        : undefined
    const token = getParam(resolvedSearchParams, "token")
    const redirectUri = getParam(resolvedSearchParams, "redirect_uri")
    const state = getParam(resolvedSearchParams, "state")
    const status = getParam(resolvedSearchParams, "status")
    const error = getParam(resolvedSearchParams, "error")

    if (!token) {
        return (
            <div className="flex flex-col gap-6">
                <Empty>
                    <EmptyTitle>No authorization request</EmptyTitle>
                    <EmptyDescription>
                        Open the app you want to sign in to and try again. The
                        authorization request starts there.
                    </EmptyDescription>
                    <EmptyActions>
                        <Button asChild>
                            <Link href="/login">Go to sign in</Link>
                        </Button>
                    </EmptyActions>
                </Empty>
            </div>
        )
    }

    const cookieStore = await cookies()
    const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value
    if (!sessionId) {
        redirect(
            buildRelativeUrl("/login", {
                token,
                redirect_uri: redirectUri,
                state,
            })
        )
    }

    let sessionInfo: SessionStatus | null = null
    let pageError = error
    let effectiveStatus = status

    if (!status && token) {
        try {
            sessionInfo = await apiGet<SessionStatus>(
                `/auth/session/status/${token}`
            )
            effectiveStatus = sessionInfo.status
            const safeRedirect = safeRedirectUrl(redirectUri)

            if (
                sessionInfo.status === "authorized" &&
                sessionInfo.sessionId &&
                safeRedirect
            ) {
                const tokenResponse = await apiGet<TokenResponse>(
                    `/session/token/${sessionInfo.sessionId}`
                )
                const redirectTarget = new URL(safeRedirect)
                redirectTarget.searchParams.set(
                    "access_token",
                    tokenResponse.accessToken
                )
                redirectTarget.searchParams.set(
                    "session_id",
                    sessionInfo.sessionId
                )
                redirectTarget.searchParams.set(
                    "expires_at",
                    tokenResponse.expiresAt
                )
                if (state) {
                    redirectTarget.searchParams.set("state", state)
                }
                redirect(redirectTarget.toString())
            }

            if (sessionInfo.status !== "pending") {
                pageError =
                    sessionInfo.status === "expired"
                        ? "This authorization request has expired."
                        : sessionInfo.status === "cancelled"
                            ? "Authorization was cancelled."
                            : "This authorization request is no longer active."
            }
        } catch (err) {
            pageError =
                err instanceof Error ? err.message : "Unable to load request."
        }
    }

    const appName = sessionInfo?.appId || "This app"
    const expiresAt = sessionInfo?.expiresAt

    const showActions =
        !pageError && (!effectiveStatus || effectiveStatus === "pending")

    // Fetch current user info for the identity card
    const currentUser = await fetchCurrentUser(sessionId)
    const displayName = currentUser ? getDisplayName(currentUser) : null
    const userEmail = currentUser?.email
    const initials = displayName ? getInitials(displayName) : "?"

    const loginUrl = buildRelativeUrl("/login", {
        token,
        redirect_uri: redirectUri,
        state,
    })

    return (
        <div className="flex flex-col gap-6 w-full max-w-md mx-auto">
            {/* Logo */}
            <div className="flex justify-center">
                <Link href="/login" className="flex items-center gap-2">
                    <Logo />
                    <span className="sr-only">Oxy</span>
                </Link>
            </div>

            <Card>
                <CardContent className="pt-6 pb-6 px-6 flex flex-col gap-5">
                    {/* Status messages for completed flows */}
                    {effectiveStatus === "approved" || effectiveStatus === "denied" ? (
                        <div className="text-center space-y-2">
                            <h1 className="text-xl font-semibold">
                                {effectiveStatus === "approved"
                                    ? "Authorization complete"
                                    : "Authorization denied"}
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                {effectiveStatus === "approved"
                                    ? "You can close this window."
                                    : "The request was denied. You can close this window."}
                            </p>
                        </div>
                    ) : (
                        <>
                            {/* User identity badge */}
                            {currentUser ? (
                                <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                                    <Avatar
                                        src={currentUser.avatar ? getAvatarUrl(currentUser.avatar) : undefined}
                                        alt={displayName || "User"}
                                        fallback={initials}
                                        size={40}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-sm truncate">
                                            {displayName}
                                        </div>
                                        {userEmail && (
                                            <div className="text-xs text-muted-foreground truncate">
                                                {userEmail}
                                            </div>
                                        )}
                                    </div>
                                    <Link
                                        href={loginUrl}
                                        className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                                    >
                                        Not you?
                                    </Link>
                                </div>
                            ) : null}

                            {/* Heading */}
                            <div className="text-center space-y-1">
                                <h1 className="text-xl font-semibold">
                                    Sign in to{" "}
                                    <span className="text-primary">{appName}</span>
                                </h1>
                                <p className="text-sm text-muted-foreground">
                                    {appName} wants to access your Oxy account
                                </p>
                            </div>

                            {/* Error state */}
                            {pageError ? (
                                <ToastMessage
                                    title="Authorization error"
                                    description={pageError}
                                    variant="error"
                                />
                            ) : null}

                            {/* Permissions section */}
                            {showActions ? (
                                <>
                                    <div className="space-y-3">
                                        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                                            <Shield className="size-4" />
                                            <span>This will allow {appName} to:</span>
                                        </div>
                                        <ul className="space-y-2 pl-1">
                                            <li className="flex items-start gap-2.5 text-sm">
                                                <Check className="size-4 text-primary shrink-0 mt-0.5" />
                                                <span>See your basic profile information</span>
                                            </li>
                                            <li className="flex items-start gap-2.5 text-sm">
                                                <Check className="size-4 text-primary shrink-0 mt-0.5" />
                                                <span>Access your account on your behalf</span>
                                            </li>
                                        </ul>
                                    </div>

                                    {expiresAt ? (
                                        <FieldDescription className="text-center text-xs">
                                            Request expires at {expiresAt}.
                                        </FieldDescription>
                                    ) : null}

                                    {/* Action buttons */}
                                    <div className="flex flex-col gap-2">
                                        <form method="post" action="/api/auth/authorize">
                                            <input type="hidden" name="decision" value="approve" />
                                            {token ? (
                                                <input type="hidden" name="token" value={token} />
                                            ) : null}
                                            {redirectUri ? (
                                                <input
                                                    type="hidden"
                                                    name="redirect_uri"
                                                    value={redirectUri}
                                                />
                                            ) : null}
                                            {state ? (
                                                <input type="hidden" name="state" value={state} />
                                            ) : null}
                                            <Button type="submit" className="w-full">
                                                Allow
                                            </Button>
                                        </form>
                                        <form method="post" action="/api/auth/authorize">
                                            <input type="hidden" name="decision" value="deny" />
                                            {token ? (
                                                <input type="hidden" name="token" value={token} />
                                            ) : null}
                                            {redirectUri ? (
                                                <input
                                                    type="hidden"
                                                    name="redirect_uri"
                                                    value={redirectUri}
                                                />
                                            ) : null}
                                            {state ? (
                                                <input type="hidden" name="state" value={state} />
                                            ) : null}
                                            <Button variant="outline" type="submit" className="w-full">
                                                Deny
                                            </Button>
                                        </form>
                                    </div>
                                </>
                            ) : null}
                        </>
                    )}
                </CardContent>
            </Card>

            {/* Footer */}
            <p className="px-6 text-center text-xs text-muted-foreground">
                By continuing, you agree to Oxy&apos;s{" "}
                <a
                    href="https://oxy.so/company/transparency/policies/terms-of-service"
                    className="underline underline-offset-4 hover:text-primary"
                >
                    Terms of Service
                </a>{" "}
                and{" "}
                <a
                    href="https://oxy.so/company/transparency/policies/privacy"
                    className="underline underline-offset-4 hover:text-primary"
                >
                    Privacy Policy
                </a>
                .
            </p>
        </div>
    )
}
