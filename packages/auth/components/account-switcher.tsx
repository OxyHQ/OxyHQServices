"use client"

import { GalleryVerticalEnd, ChevronRight, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"

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
    const avatarUrl = account.avatar
        ? `https://api.oxy.so/api/files/${account.avatar}`
        : `https://api.dicebear.com/7.x/avataaars/svg?seed=${account.username || account.id}`

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <Card>
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-2">
                        <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
                            <GalleryVerticalEnd className="size-6" />
                        </div>
                    </div>
                    <CardTitle className="text-xl">Choose an account</CardTitle>
                    <CardDescription>to continue to the app</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                    {/* Current account */}
                    <Button
                        variant="outline"
                        className="w-full h-auto p-4 justify-start"
                        onClick={onContinue}
                        disabled={isLoading}
                    >
                        <img
                            src={avatarUrl}
                            alt={account.displayName || "User avatar"}
                            className="size-10 rounded-full bg-muted shrink-0"
                        />
                        <div className="flex-1 text-left ml-3 min-w-0">
                            <div className="font-medium truncate">
                                {account.displayName || account.username}
                            </div>
                            {account.email && (
                                <div className="text-sm text-muted-foreground truncate">
                                    {account.email}
                                </div>
                            )}
                        </div>
                        <ChevronRight className="size-5 text-muted-foreground shrink-0" />
                    </Button>

                    {/* Use another account */}
                    <Button
                        variant="outline"
                        className="w-full h-auto p-4 justify-start"
                        onClick={onUseAnother}
                        disabled={isLoading}
                    >
                        <div className="size-10 rounded-full bg-muted flex items-center justify-center shrink-0">
                            <UserPlus className="size-5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 text-left ml-3">
                            <div className="font-medium">Use another account</div>
                        </div>
                        <ChevronRight className="size-5 text-muted-foreground shrink-0" />
                    </Button>
                </CardContent>
            </Card>
            <p className="px-6 text-center text-sm text-muted-foreground">
                By continuing, you agree to our{" "}
                <a href="#" className="underline underline-offset-4 hover:text-primary">
                    Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="underline underline-offset-4 hover:text-primary">
                    Privacy Policy
                </a>
                .
            </p>
        </div>
    )
}
