import { type NextRequest, NextResponse } from "next/server"

import { apiPost, getForwardHeaders } from "@/lib/oxy-api"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json()
        const recoveryToken = String(body.recoveryToken || "").trim()
        const password = String(body.password || "")

        if (!recoveryToken) {
            return NextResponse.json(
                { message: "Recovery token is required" },
                { status: 400 }
            )
        }

        if (!password) {
            return NextResponse.json(
                { message: "Password is required" },
                { status: 400 }
            )
        }

        await apiPost(
            "/auth/recover/reset",
            { recoveryToken, password },
            { headers: getForwardHeaders(request) }
        )

        return NextResponse.json({ success: true })
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "Unable to reset password"
        return NextResponse.json({ message }, { status: 400 })
    }
}
