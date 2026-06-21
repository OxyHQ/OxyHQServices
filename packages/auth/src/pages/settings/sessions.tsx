import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Monitor, LogOut, Loader2 } from "lucide-react"
import { buildApiUrl } from "@/lib/oxy-api-client"
import { mintAccessTokenFromRefreshCookie } from "@/lib/session-auth"
import { Button } from "@oxyhq/bloom/button"
import { AuthFormHeader } from "@/components/auth-form-layout"

type Session = {
    _id: string
    deviceName?: string
    browser?: string
    os?: string
    ip?: string
    lastActive?: string
    current?: boolean
}

export function SessionsPage() {
    const [sessions, setSessions] = useState<Session[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [revokingId, setRevokingId] = useState<string | null>(null)

    useEffect(() => {
        loadSessions()
    }, [])

    async function loadSessions() {
        try {
            const auth = await mintAccessTokenFromRefreshCookie()
            if (!auth) {
                setSessions([])
                return
            }

            const res = await fetch(buildApiUrl(`/session/sessions/${auth.sessionId}`), {
                credentials: "include",
                headers: { Authorization: `Bearer ${auth.accessToken}` },
            })
            if (!res.ok) return
            const data = await res.json()
            setSessions(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [])
        } catch {
            // Failed to load sessions
        } finally {
            setIsLoading(false)
        }
    }

    async function revokeSession(targetSessionId: string) {
        setRevokingId(targetSessionId)
        try {
            const auth = await mintAccessTokenFromRefreshCookie()
            if (!auth) {
                toast.error("Session expired")
                return
            }

            const res = await fetch(buildApiUrl(`/session/logout/${auth.sessionId}/${targetSessionId}`), {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    Authorization: `Bearer ${auth.accessToken}`,
                },
                credentials: "include",
            })
            if (res.ok) {
                setSessions((prev) => prev.filter((s) => s._id !== targetSessionId))
                toast.success("Session revoked")
            }
        } catch {
            toast.error("Failed to revoke session")
        } finally {
            setRevokingId(null)
        }
    }

    async function revokeAllSessions() {
        setRevokingId("all")
        try {
            const auth = await mintAccessTokenFromRefreshCookie()
            if (!auth) {
                toast.error("Session expired")
                return
            }

            const res = await fetch(buildApiUrl(`/session/logout-all/${auth.sessionId}`), {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    Authorization: `Bearer ${auth.accessToken}`,
                },
                credentials: "include",
            })
            if (res.ok) {
                toast.success("All other sessions revoked")
                loadSessions()
            }
        } catch {
            toast.error("Failed to revoke sessions")
        } finally {
            setRevokingId(null)
        }
    }

    function formatLastActive(date?: string): string {
        if (!date) return "Unknown"
        const d = new Date(date)
        const now = new Date()
        const diffMs = now.getTime() - d.getTime()
        const diffMin = Math.floor(diffMs / 60000)
        if (diffMin < 1) return "Just now"
        if (diffMin < 60) return `${diffMin}m ago`
        const diffHr = Math.floor(diffMin / 60)
        if (diffHr < 24) return `${diffHr}h ago`
        const diffDays = Math.floor(diffHr / 24)
        return `${diffDays}d ago`
    }

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
                <AuthFormHeader title="Active sessions" description="Manage your signed-in devices" />
                {sessions.length > 1 && (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={revokeAllSessions}
                        loading={revokingId === "all"}
                        disabled={revokingId === "all"}
                    >
                        Sign out all others
                    </Button>
                )}
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
            ) : sessions.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active sessions found.</p>
            ) : (
                <div className="space-y-3">
                    {sessions.map((session) => (
                        <div key={session._id} className="flex items-center gap-4 rounded-lg border p-4">
                            <Monitor className="size-5 text-muted-foreground shrink-0" />
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate">
                                    {session.browser || session.deviceName || "Unknown device"}
                                    {session.os && ` on ${session.os}`}
                                    {session.current && (
                                        <span className="ml-2 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Current</span>
                                    )}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                    {session.ip && `${session.ip} · `}
                                    {formatLastActive(session.lastActive)}
                                </div>
                            </div>
                            {!session.current && (
                                <Button
                                    variant="outline"
                                    size="icon"
                                    onClick={() => revokeSession(session._id)}
                                    loading={revokingId === session._id}
                                    disabled={revokingId === session._id}
                                    aria-label="Sign out this session"
                                >
                                    <LogOut className="size-3" />
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
