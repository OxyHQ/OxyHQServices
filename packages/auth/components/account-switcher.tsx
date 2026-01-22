"use client"

import { GalleryVerticalEnd, ChevronRight, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { FieldDescription, FieldGroup } from "@/components/ui/field"

type Account = {
    id: string
    username?: string
    email?: string
    avatar?: string
    displayName?: string
}

type AccountSwitcherProps = React.ComponentProps<"div"> & {
    account: Account
    sessionId: string
    onContinue: () => void
    onUseAnother: () => void
    isLoading?: boolean
}

export function AccountSwitcher({
    className,
    account,
    sessionId,
    onContinue,
    onUseAnother,
    isLoading,
    ...props
}: AccountSwitcherProps) {
    const avatarUrl =
        account.avatar ||
        `https://api.dicebear.com/7.x/avataaars/svg?seed=${account.username || account.id}`

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <FieldGroup>
                <div className="flex flex-col items-center gap-2 text-center">
                    <a
                        href="#"
                        className="flex flex-col items-center gap-2 font-medium"
                    >
                        <div className="flex size-8 items-center justify-center rounded-md">
                            <GalleryVerticalEnd className="size-6" />
                        </div>
                        <span className="sr-only">Acme Inc.</span>
                    </a>
                    <h1 className="text-xl font-bold">Choose an account</h1>
                    <FieldDescription>
                        to continue to the app
                    </FieldDescription>
                </div>

                <div className="mt-4 space-y-2">
                    {/* Current account */}
                    <button
                        type="button"
                        onClick={onContinue}
                        disabled={isLoading}
                        className={cn(
                            "w-full flex items-center gap-4 p-4 rounded-lg border border-border",
                            "hover:bg-accent hover:border-accent-foreground/20 transition-colors",
                            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        <img
                            src={avatarUrl}
                            alt={account.displayName || "User avatar"}
                            className="size-10 rounded-full bg-muted"
                        />
                        <div className="flex-1 text-left">
                            <div className="font-medium">
                                {account.displayName || account.username}
                            </div>
                            {account.email && (
                                <div className="text-sm text-muted-foreground">
                                    {account.email}
                                </div>
                            )}
                        </div>
                        <ChevronRight className="size-5 text-muted-foreground" />
                    </button>

                    {/* Use another account */}
                    <button
                        type="button"
                        onClick={onUseAnother}
                        disabled={isLoading}
                        className={cn(
                            "w-full flex items-center gap-4 p-4 rounded-lg border border-border",
                            "hover:bg-accent hover:border-accent-foreground/20 transition-colors",
                            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                            "disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        <div className="size-10 rounded-full bg-muted flex items-center justify-center">
                            <UserPlus className="size-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 text-left">
                            <div className="font-medium">Use another account</div>
                        </div>
                        <ChevronRight className="size-5 text-muted-foreground" />
                    </button>
                </div>
            </FieldGroup>
            <FieldDescription className="px-6 text-center">
                By continuing, you agree to our <a href="#">Terms of Service</a>{" "}
                and <a href="#">Privacy Policy</a>.
            </FieldDescription>
        </div>
    )
}
