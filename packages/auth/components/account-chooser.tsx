import { ChevronRight, UserPlus } from "lucide-react"
import type { SwitchableAccount } from "@oxyhq/core"
import { cn } from "@/lib/utils"
import { Button } from "@oxyhq/bloom/button"
import { Avatar } from "@oxyhq/bloom/avatar"
import { AuthFormHeader } from "@/components/auth-form-layout"
import { useHoverColorPreset } from "@/lib/use-hover-color-preset"

type AccountChooserProps = React.ComponentProps<"div"> & {
    /**
     * Accounts signed in on this device (1..N), current account first. Sourced
     * from the SAME device-first SDK projection every Oxy app uses
     * (`useSwitchableAccounts` → `projectSwitchableAccounts`). Each row carries a
     * resolved `displayName` / `email` / `avatarUrl` / `color` — the IdP no
     * longer re-derives any of them.
     */
    accounts: SwitchableAccount[]
    /** App name to continue to, e.g. "Console". Falls back to a generic label. */
    appName?: string | null
    /** Selecting an account row. The IdP switches INTO `account.accountId`. */
    onSelectAccount: (account: SwitchableAccount) => void
    /** "Use a different account" → reveals the sign-in form. */
    onUseAnother: () => void
    /** The accountId currently being switched to (disables that row's spinner peers). */
    pendingAccountId?: string | null
    /** Disables every row while a selection is in flight. */
    isLoading?: boolean
}

/**
 * Google-style account chooser. Lists every account signed in on this device
 * and a "Use a different account" affordance. Rendered as an additive FRONT
 * screen before the sign-in form / OAuth consent — selecting a row switches into
 * that account through the shared device-first switch path
 * (`useOxy().switchToAccount`) exactly like every other Oxy surface.
 */
export function AccountChooser({
    className,
    accounts,
    appName,
    onSelectAccount,
    onUseAnother,
    pendingAccountId,
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
                    const isPending = pendingAccountId === entry.accountId
                    const hoverHandlers = hoverPreset.getHandlers(entry.color)
                    return (
                        // The hover/focus handlers drive the per-account color
                        // preset; the Bloom Button forwards no DOM hover/focus
                        // events, so they live on a wrapping element that also
                        // bubbles keyboard focus (React onFocus/onBlur bubble).
                        <div
                            key={entry.accountId}
                            onMouseEnter={hoverHandlers.onMouseEnter}
                            onMouseLeave={hoverHandlers.onMouseLeave}
                            onFocus={hoverHandlers.onFocus}
                            onBlur={hoverHandlers.onBlur}
                        >
                            <Button
                                variant="outline"
                                size="lg"
                                className="w-full h-auto p-4 justify-start"
                                onClick={() => onSelectAccount(entry)}
                                disabled={isLoading}
                                aria-label={`Continue as ${entry.displayName}`}
                            >
                                <Avatar source={entry.avatarUrl} size={40} />
                                <div className="flex-1 text-left ml-3 min-w-0" aria-busy={isPending}>
                                    <div className="font-medium truncate">
                                        {entry.displayName}
                                    </div>
                                    {entry.email && (
                                        <div className="text-sm text-muted-foreground truncate">
                                            {entry.email}
                                        </div>
                                    )}
                                </div>
                                <ChevronRight className="size-5 text-muted-foreground shrink-0" />
                            </Button>
                        </div>
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
