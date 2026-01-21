import Link from "next/link"
import { GalleryVerticalEnd } from "lucide-react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup } from "@/components/ui/field"
import { ToastMessage } from "@/components/toast-message"
import { Empty, EmptyActions, EmptyDescription, EmptyTitle } from "@/components/ui/empty"
import {
    apiGet,
    buildRelativeUrl,
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

function getParam(
    params: Record<string, string | string[] | undefined> | undefined,
    key: string
) {
    const value = params?.[key]
    return typeof value === "string" ? value : undefined
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
                `/api/auth/session/status/${token}`
            )
            effectiveStatus = sessionInfo.status
            const safeRedirect = safeRedirectUrl(redirectUri)

            if (
                sessionInfo.status === "authorized" &&
                sessionInfo.sessionId &&
                safeRedirect
            ) {
                const tokenResponse = await apiGet<TokenResponse>(
                    `/api/session/token/${sessionInfo.sessionId}`
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

    const appName = sessionInfo?.appId || "this app"
    const expiresAt = sessionInfo?.expiresAt

    const showActions =
        !pageError && (!effectiveStatus || effectiveStatus === "pending")

    return (
        <div className="flex flex-col gap-6">
            <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                    <Link
                        href="/login"
                        className="flex flex-col items-center gap-2 font-medium"
                    >
                        <div className="flex size-8 items-center justify-center rounded-md">
                            <GalleryVerticalEnd className="size-6" />
                        </div>
                        <span className="sr-only">Acme Inc.</span>
                    </Link>
                    <h1 className="text-xl font-bold">Authorize sign in</h1>
                    <FieldDescription>
                        {effectiveStatus === "approved"
                            ? "Authorization complete."
                            : effectiveStatus === "denied"
                                ? "Authorization was denied."
                                : `Allow ${appName} to access your Oxy account?`}
                    </FieldDescription>
                </div>

                {pageError ? (
                    <>
                        <ToastMessage
                            title="Authorization error"
                            description={pageError}
                            variant="error"
                        />
                        <FieldDescription className="text-center">
                            {pageError}
                        </FieldDescription>
                    </>
                ) : null}

                {showActions ? (
                    <>
                        {expiresAt ? (
                            <FieldDescription>
                                Request expires at {expiresAt}.
                            </FieldDescription>
                        ) : null}
                        <Field className="grid gap-3 sm:grid-cols-2">
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
                                    Authorize
                                </Button>
                            </form>
                        </Field>
                        <FieldDescription className="text-center">
                            <Link
                                href={buildRelativeUrl("/login", {
                                    token,
                                    redirect_uri: redirectUri,
                                    state,
                                })}
                            >
                                Use a different account
                            </Link>
                        </FieldDescription>
                    </>
                ) : null}
            </FieldGroup>
        </div>
    )
}
