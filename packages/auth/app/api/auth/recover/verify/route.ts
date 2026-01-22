import { type NextRequest, NextResponse } from "next/server"

import { apiPost, getForwardHeaders } from "@/lib/oxy-api"

type RecoveryVerifyResponse = {
    recoveryToken: string
    expiresAt?: string
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const identifier = String(body.identifier || "").trim()
        const code = String(body.code || "").trim()

        if (!identifier) {
            return NextResponse.json(
                { message: "Email or username is required" },
                { status: 400 }
            )
        }

        if (!code) {
            return NextResponse.json(
                { message: "Recovery code is required" },
                { status: 400 }
            )
        }

        const response = await apiPost<RecoveryVerifyResponse>(
            "/api/auth/recover/verify",
            { identifier, code },
            { headers: getForwardHeaders(request) }
        )

        return NextResponse.json(response)
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to verify code"
        return NextResponse.json({ message }, { status: 400 })
    }
}
