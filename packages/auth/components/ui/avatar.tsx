"use client"

import { cn } from "@/lib/utils"

type AvatarProps = {
    src?: string | null
    name?: string
    size?: "sm" | "md" | "lg"
    className?: string
}

const sizeClasses = {
    sm: "size-8 text-xs",
    md: "size-10 text-sm",
    lg: "size-16 text-lg",
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

export function Avatar({ src, name = "User", size = "md", className }: AvatarProps) {
    const initials = getInitials(name)
    const avatarUrl = src ? getAvatarUrl(src) : null

    return avatarUrl ? (
        <img
            src={avatarUrl}
            alt={name}
            className={cn(
                "rounded-full bg-muted shrink-0 object-cover",
                sizeClasses[size],
                className
            )}
        />
    ) : (
        <div
            className={cn(
                "rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0 font-semibold",
                sizeClasses[size],
                className
            )}
        >
            {initials}
        </div>
    )
}
