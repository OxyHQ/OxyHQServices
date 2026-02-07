/**
 * Get Access Token by Session ID
 *
 * Returns the access token for a given session ID.
 * Used by the account switcher to get tokens for existing sessions.
 */

import { NextRequest, NextResponse } from "next/server"
import { apiGet } from "@/lib/oxy-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface TokenResponse {
    accessToken: string
    expiresAt: string
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    try {
        const { sessionId } = await params

        if (!sessionId) {
            return NextResponse.json(
                { message: "Session ID is required" },
                { status: 400 }
            )
        }

        const tokenData = await apiGet<TokenResponse>(
            `/session/token/${sessionId}`
        )

        return NextResponse.json({
            accessToken: tokenData.accessToken,
            expiresAt: tokenData.expiresAt,
        })
    } catch (error) {
        console.error("[Auth Token] Error:", error)
        return NextResponse.json(
            { message: "Invalid or expired session" },
            { status: 401 }
        )
    }
}
