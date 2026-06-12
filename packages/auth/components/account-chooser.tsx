import { ChevronRight, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar } from "@oxyhq/bloom/avatar"
import { AuthFormHeader } from "@/components/auth-form-layout"
import { getAvatarUrl } from "@/lib/oxy-api-client"
import type { DeviceAccount } from "@/lib/types"
import { useHoverColorPreset } from "@/lib/use-hover-color-preset"

type AccountChooserProps = React.ComponentProps<"div"> & {
    /** Accounts signed in on this device (1..N), current account first. */
    accounts: DeviceAccount[]
    /** App name to continue to, e.g. "Console". Falls back to a generic label. */
    appName?: string | null
    /** Selecting an account row. `isCurrent` distinguishes continue vs re-auth. */
    onSelectAccount: (account: DeviceAccount) => void
    /** "Use a different account" → reveals the sign-in form. */
    onUseAnother: () => void
    /** The sessionId currently being acted on (disables that row's spinner peers). */
    pendingSessionId?: string | null
    /** Disables every row while a selection is in flight. */
    isLoading?: boolean
}

function displayNameFor(account: DeviceAccount["account"]): string {
    return account.displayName || account.username || account.email || "User"
}

/**
 * Google-style account chooser. Lists every account signed in on this device
 * and a "Use a different account" affordance. Rendered as an additive FRONT
 * screen before the sign-in form / OAuth consent — selecting a row funnels into
 * the SAME completion path that exists today (continue for the current account,
 * pre-filled re-auth for the others).
 */
export function AccountChooser({
    className,
    accounts,
    appName,
    onSelectAccount,
    onUseAnother,
    pendingSessionId,
    isLoading,
    ...props
}: AccountChooserProps) {
    const description = appName
        ? `to continue to ${appName}`
        : "Choose an account to continue"

    const hoverPreset = useHoverColorPreset("chooser-hover")

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <AuthFormHeader title="Choose an account" description={description} />
            <div className="space-y-2">
                {accounts.map((entry) => {
                    const { account } = entry
                    const isPending = pendingSessionId === entry.sessionId
                    const hoverHandlers = hoverPreset.getHandlers(account.color)
                    return (
                        <Button
                            key={entry.sessionId}
                            variant="outline"
                            size="lg"
                            className="w-full h-auto p-4 justify-start"
                            onClick={() => onSelectAccount(entry)}
                            disabled={isLoading}
                            aria-busy={isPending}
                            onMouseEnter={hoverHandlers.onMouseEnter}
                            onMouseLeave={hoverHandlers.onMouseLeave}
                            onFocus={hoverHandlers.onFocus}
                            onBlur={hoverHandlers.onBlur}
                        >
                            <Avatar
                                source={
                                    account.avatar
                                        ? getAvatarUrl(account.avatar)
                                        : undefined
                                }
                                size={40}
                            />
                            <div className="flex-1 text-left ml-3 min-w-0">
                                <div className="font-medium truncate">
                                    {displayNameFor(account)}
                                </div>
                                {account.email && (
                                    <div className="text-sm text-muted-foreground truncate">
                                        {account.email}
                                    </div>
                                )}
                            </div>
                            <ChevronRight className="size-5 text-muted-foreground shrink-0" />
                        </Button>
                    )
                })}

                <Button
                    variant="outline"
                    size="lg"
                    className="w-full h-auto p-4 justify-start"
                    onClick={onUseAnother}
                    disabled={isLoading}
                >
                    <div className="size-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <UserPlus className="size-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 text-left ml-3">
                        <div className="font-medium">Use a different account</div>
                    </div>
                    <ChevronRight className="size-5 text-muted-foreground shrink-0" />
                </Button>
            </div>
        </div>
    )
}
