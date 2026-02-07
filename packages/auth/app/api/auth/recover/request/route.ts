import { type NextRequest, NextResponse } from "next/server"

import { apiPost, getForwardHeaders } from "@/lib/oxy-api"

type RecoveryRequestResponse = {
    devCode?: string
    expiresAt?: string
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const identifier = String(body.identifier || "").trim()

        if (!identifier) {
            return NextResponse.json(
                { message: "Email or username is required" },
                { status: 400 }
            )
        }

        const response = await apiPost<RecoveryRequestResponse>(
            "/auth/recover/request",
            { identifier },
            { headers: getForwardHeaders(request) }
        )

        return NextResponse.json(response)
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to process request"
        return NextResponse.json({ message }, { status: 400 })
    }
}
