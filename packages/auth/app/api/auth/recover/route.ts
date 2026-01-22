import { NextResponse, type NextRequest } from "next/server"

import {
    apiPost,
    buildRelativeUrl,
    getForwardHeaders,
    getPublicBaseUrl,
    RECOVERY_COOKIE_NAME,
} from "@/lib/oxy-api"

type RecoveryRequestResponse = {
    devCode?: string
    expiresAt?: string
}

type RecoveryVerifyResponse = {
    recoveryToken: string
    expiresAt?: string
}

function redirectWithError(
    request: NextRequest,
    params: Record<string, string | undefined>,
    message: string
) {
    const url = new URL(
        buildRelativeUrl("/recover", {
            ...params,
            error: message,
        }),
        getPublicBaseUrl(request)
    )
    return NextResponse.redirect(url, 303)
}

export async function POST(request: NextRequest) {
    const formData = await request.formData()
    const step = String(formData.get("step") || "request")
    const identifier = String(formData.get("identifier") || "").trim()

    if (!identifier && step !== "reset") {
        return redirectWithError(request, {}, "Email or username is required")
    }

    try {
        if (step === "request") {
            const response = await apiPost<RecoveryRequestResponse>(
                "/api/auth/recover/request",
                { identifier },
                { headers: getForwardHeaders(request) }
            )

            return NextResponse.redirect(
                new URL(
                    buildRelativeUrl("/recover", {
                        step: "verify",
                        identifier,
                        devCode: response.devCode,
                    }),
                    getPublicBaseUrl(request)
                ),
                303
            )
        }

        if (step === "verify") {
            const code = String(formData.get("code") || "").trim()
            if (!code) {
                return redirectWithError(
                    request,
                    { step: "verify", identifier },
                    "Recovery code is required"
                )
            }

            const response = await apiPost<RecoveryVerifyResponse>(
                "/api/auth/recover/verify",
                { identifier, code },
                { headers: getForwardHeaders(request) }
            )

            const redirectUrl = new URL(
                buildRelativeUrl("/recover", {
                    step: "reset",
                    identifier,
                }),
                getPublicBaseUrl(request)
            )

            const res = NextResponse.redirect(redirectUrl, 303)
            const expiresAt = response.expiresAt
                ? new Date(response.expiresAt)
                : undefined
            res.cookies.set(RECOVERY_COOKIE_NAME, response.recoveryToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === "production",
                sameSite: "lax",
                path: "/",
                ...(expiresAt ? { expires: expiresAt } : {}),
            })
            return res
        }

        if (step === "reset") {
            const password = String(formData.get("password") || "")
            const recoveryToken = request.cookies.get(RECOVERY_COOKIE_NAME)?.value

            if (!recoveryToken) {
                return redirectWithError(
                    request,
                    {},
                    "Recovery session expired. Request a new code."
                )
            }

            if (!password) {
                return redirectWithError(
                    request,
                    { step: "reset", identifier },
                    "Password is required"
                )
            }

            await apiPost(
                "/api/auth/recover/reset",
                { recoveryToken, password },
                { headers: getForwardHeaders(request) }
            )

            const res = NextResponse.redirect(
                new URL(buildRelativeUrl("/login", { reset: "1" }), getPublicBaseUrl(request)),
                303
            )
            res.cookies.delete(RECOVERY_COOKIE_NAME)
            return res
        }

        return redirectWithError(request, {}, "Invalid recovery step")
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to process request"
        return redirectWithError(request, { step, identifier }, message)
    }
}
