import { ChevronRight, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Avatar } from "@oxyhq/bloom/avatar"
import { AuthFormHeader } from "@/components/auth-form-layout"
import { getAvatarUrl } from "@/lib/oxy-api-client"
import type { Account } from "@/lib/types"

type AccountSwitcherProps = React.ComponentProps<"div"> & {
    account: Account
    onContinue: () => void
    onUseAnother: () => void
    isLoading?: boolean
}

export function AccountSwitcher({
    className,
    account,
    onContinue,
    onUseAnother,
    isLoading,
    ...props
}: AccountSwitcherProps) {
    const displayName = account.displayName || account.username || "User"

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <AuthFormHeader title="Choose an account" description="to continue to the app" />
            <div className="space-y-2">
                <Button variant="outline" size="lg" className="w-full h-auto p-4 justify-start" onClick={onContinue} disabled={isLoading}>
                    <Avatar source={account.avatar ? getAvatarUrl(account.avatar) : undefined} size={40} />
                    <div className="flex-1 text-left ml-3 min-w-0">
                        <div className="font-medium truncate">{displayName}</div>
                        {account.email && (
                            <div className="text-sm text-muted-foreground truncate">{account.email}</div>
                        )}
                    </div>
                    <ChevronRight className="size-5 text-muted-foreground shrink-0" />
                </Button>

                <Button variant="outline" size="lg" className="w-full h-auto p-4 justify-start" onClick={onUseAnother} disabled={isLoading}>
                    <div className="size-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                        <UserPlus className="size-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 text-left ml-3">
                        <div className="font-medium">Use another account</div>
                    </div>
                    <ChevronRight className="size-5 text-muted-foreground shrink-0" />
                </Button>
            </div>
        </div>
    )
}
