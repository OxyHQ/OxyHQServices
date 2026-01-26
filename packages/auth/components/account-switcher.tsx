"use client"

import { ChevronRight, UserPlus } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Logo } from "@/components/logo"

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

function getInitials(name: string): string {
    return name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
}

function getAvatarUrl(fileId: string): string {
    return `https://cloud.oxy.so/assets/${encodeURIComponent(fileId)}/stream?variant=thumb`
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
    const displayName = account.displayName || account.username || "User"
    const initials = getInitials(displayName)

    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            <Card>
                <CardHeader className="text-center pb-2">
                    <div className="flex justify-center mb-2">
                        <Logo />
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
                        <Avatar>
                            {account.avatar && (
                                <AvatarImage src={getAvatarUrl(account.avatar)} alt={displayName} />
                            )}
                            <AvatarFallback className="bg-primary text-primary-foreground font-semibold">
                                {initials}
                            </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 text-left ml-3 min-w-0">
                            <div className="font-medium truncate">{displayName}</div>
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
                <a href="https://oxy.so/company/transparency/policies/terms-of-service" className="underline underline-offset-4 hover:text-primary">
                    Terms of Service
                </a>{" "}
                and{" "}
                <a href="https://oxy.so/company/transparency/policies/privacy" className="underline underline-offset-4 hover:text-primary">
                    Privacy Policy
                </a>
                .
            </p>
        </div>
    )
}
