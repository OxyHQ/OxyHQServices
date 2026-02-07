/**
 * Get Current User Endpoint
 *
 * Returns the currently signed-in user's information based on the session cookie.
 * Used by the account switcher to show existing accounts.
 */

import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { apiGet, SESSION_COOKIE_NAME } from "@/lib/oxy-api"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

interface User {
    id: string
    username?: string
    email?: string
    avatar?: string
    name?: {
        first?: string
        last?: string
    }
}

export async function GET() {
    try {
        const cookieStore = await cookies()
        const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME)

        if (!sessionCookie) {
            return NextResponse.json({ user: null })
        }

        try {
            const user = await apiGet<User>(
                `/session/user/${sessionCookie.value}`
            )

            return NextResponse.json({
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    avatar: user.avatar,
                    name: user.name,
                    displayName:
                        user.name?.first && user.name?.last
                            ? `${user.name.first} ${user.name.last}`
                            : user.username || user.email,
                },
                sessionId: sessionCookie.value,
            })
        } catch {
            // Invalid session
            return NextResponse.json({ user: null })
        }
    } catch (error) {
        console.error("[Auth Me] Error:", error)
        return NextResponse.json({ user: null })
    }
}
