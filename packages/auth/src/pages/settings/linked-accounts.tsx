import { useState, useEffect } from "react"
import { toast } from "sonner"
import { KeyRound, Loader2, Trash2 } from "lucide-react"
import { buildApiUrl } from "@/lib/oxy-api-client"
import { Button } from "@/components/ui/button"
import { AuthFormHeader } from "@/components/auth-form-layout"

type AuthMethod = {
    type: string
    provider?: string
    email?: string
    username?: string
    linkedAt?: string
}

const providerLabels: Record<string, string> = {
    password: "Password",
    google: "Google",
    apple: "Apple",
    github: "GitHub",
    identity: "Public Key",
}

function getProviderIcon(type: string) {
    return <KeyRound className="size-4" />
}

export function LinkedAccountsPage() {
    const [methods, setMethods] = useState<AuthMethod[]>([])
    const [isLoading, setIsLoading] = useState(true)
    const [unlinkingType, setUnlinkingType] = useState<string | null>(null)

    useEffect(() => {
        loadMethods()
    }, [])

    async function loadMethods() {
        const accessToken = sessionStorage.getItem("oxy_access_token")

        try {
            const headers: Record<string, string> = {}
            if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`

            const res = await fetch(buildApiUrl("/auth/methods"), {
                credentials: "include",
                headers,
            })
            if (!res.ok) return
            const data = await res.json()
            setMethods(Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : [])
        } catch {
            // Failed to load
        } finally {
            setIsLoading(false)
        }
    }

    async function unlinkMethod(type: string) {
        const accessToken = sessionStorage.getItem("oxy_access_token")

        setUnlinkingType(type)
        try {
            const headers: Record<string, string> = { "content-type": "application/json" }
            if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`

            const res = await fetch(buildApiUrl(`/auth/link/${type}`), {
                method: "DELETE",
                headers,
                credentials: "include",
            })
            if (res.ok) {
                setMethods((prev) => prev.filter((m) => m.type !== type))
                toast.success(`${providerLabels[type] || type} unlinked`)
            } else {
                const payload = await res.json().catch(() => ({}))
                toast.error(typeof payload?.message === "string" ? payload.message : "Unable to unlink")
            }
        } catch {
            toast.error("Failed to unlink account")
        } finally {
            setUnlinkingType(null)
        }
    }

    return (
        <div className="flex flex-col gap-6">
            <AuthFormHeader title="Linked accounts" description="Manage how you sign in" />

            {isLoading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="size-6 animate-spin text-muted-foreground" />
                </div>
            ) : methods.length === 0 ? (
                <p className="text-sm text-muted-foreground">No linked accounts found.</p>
            ) : (
                <div className="space-y-3">
                    {methods.map((method) => (
                        <div key={method.type} className="flex items-center gap-4 rounded-lg border p-4">
                            {getProviderIcon(method.type)}
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">
                                    {providerLabels[method.type] || method.type}
                                </div>
                                {method.email && (
                                    <div className="text-xs text-muted-foreground truncate">{method.email}</div>
                                )}
                            </div>
                            {methods.length > 1 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => unlinkMethod(method.type)}
                                    disabled={unlinkingType === method.type}
                                >
                                    {unlinkingType === method.type ? (
                                        <Loader2 className="size-3 animate-spin" />
                                    ) : (
                                        <Trash2 className="size-3" />
                                    )}
                                </Button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
