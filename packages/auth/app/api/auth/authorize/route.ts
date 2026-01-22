import { NextResponse, type NextRequest } from "next/server"

import {
    apiGet,
    apiPost,
    buildRelativeUrl,
    getForwardHeaders,
    getPublicBaseUrl,
    safeRedirectUrl,
    SESSION_COOKIE_NAME,
} from "@/lib/oxy-api"

type AuthorizeResponse = {
    sessionId?: string
}

type TokenResponse = {
    accessToken: string
    expiresAt: string
}

const INVALID_SESSION_MESSAGES = [
    "invalid user session",
    "invalid or expired session",
    "invalid session",
    "session expired",
]

function isInvalidSessionError(error: unknown): boolean {
    if (!(error instanceof Error)) {
        return false
    }

    const message = error.message.toLowerCase()
    return INVALID_SESSION_MESSAGES.some((snippet) => message.includes(snippet))
}

function redirectWithError(
    request: NextRequest,
    params: Record<string, string | undefined>,
    message: string
) {
    const url = new URL(
        buildRelativeUrl("/authorize", {
            ...params,
            error: message,
        }),
        getPublicBaseUrl(request)
    )
    return NextResponse.redirect(url, 303)
}

function buildExternalRedirect(
    target: string,
    params: Record<string, string | undefined>
) {
    const url = new URL(target)
    for (const [key, value] of Object.entries(params)) {
        if (value) {
            url.searchParams.set(key, value)
        }
    }
    return url.toString()
}

export async function POST(request: NextRequest) {
    const formData = await request.formData()
    const decision = String(formData.get("decision") || "")
    const sessionToken = String(formData.get("token") || "")
    const redirectUri = String(formData.get("redirect_uri") || "")
    const state = String(formData.get("state") || "")
    const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value

    if (!sessionId) {
        const loginUrl = new URL(
            buildRelativeUrl("/login", {
                token: sessionToken,
                redirect_uri: redirectUri,
                state,
            }),
            getPublicBaseUrl(request)
        )
        return NextResponse.redirect(loginUrl, 303)
    }

    if (decision !== "approve" && decision !== "deny") {
        return redirectWithError(request, { token: sessionToken }, "Invalid action")
    }

    const safeRedirect = safeRedirectUrl(redirectUri)

    if (decision === "deny") {
        try {
            if (sessionToken) {
                await apiPost(`/api/auth/session/cancel/${sessionToken}`, {}, {
                    headers: getForwardHeaders(request),
                })
            }
        } catch {
            // Ignore cancellation errors
        }

        if (safeRedirect) {
            return NextResponse.redirect(
                buildExternalRedirect(safeRedirect, {
                    error: "access_denied",
                    state: state || undefined,
                }),
                303
            )
        }

        return NextResponse.redirect(
            new URL(
                buildRelativeUrl("/authorize", {
                    token: sessionToken || undefined,
                    status: "denied",
                }),
                getPublicBaseUrl(request)
            ),
            303
        )
    }

    try {
        let sessionIdForApp = sessionId
        if (sessionToken) {
            const response = await apiPost<AuthorizeResponse>(
                `/api/auth/session/authorize/${sessionToken}`,
                {},
                {
                    headers: {
                        ...getForwardHeaders(request),
                        "x-session-id": sessionId,
                    },
                }
            )

            if (response?.sessionId) {
                sessionIdForApp = response.sessionId
            }
        }

        if (safeRedirect) {
            const token = await apiGet<TokenResponse>(
                `/api/session/token/${sessionIdForApp}`,
                { headers: getForwardHeaders(request) }
            )

            return NextResponse.redirect(
                buildExternalRedirect(safeRedirect, {
                    access_token: token.accessToken,
                    session_id: sessionIdForApp,
                    expires_at: token.expiresAt,
                    state: state || undefined,
                }),
                303
            )
        }

        return NextResponse.redirect(
            new URL(
                buildRelativeUrl("/authorize", {
                    token: sessionToken || undefined,
                    status: "approved",
                }),
                getPublicBaseUrl(request)
            ),
            303
        )
    } catch (error) {
        if (isInvalidSessionError(error)) {
            const loginUrl = new URL(
                buildRelativeUrl("/login", {
                    token: sessionToken || undefined,
                    redirect_uri: redirectUri || undefined,
                    state: state || undefined,
                    error: "Session expired. Please sign in again.",
                }),
                getPublicBaseUrl(request)
            )
            const response = NextResponse.redirect(loginUrl, 303)
            response.cookies.delete(SESSION_COOKIE_NAME)
            return response
        }

        const message =
            error instanceof Error ? error.message : "Authorization failed"
        return redirectWithError(
            request,
            {
                token: sessionToken || undefined,
                redirect_uri: redirectUri || undefined,
                state: state || undefined,
            },
            message
        )
    }
}
