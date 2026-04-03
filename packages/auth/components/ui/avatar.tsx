"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface AvatarProps {
    src?: string | null
    alt?: string
    size?: number
    className?: string
    fallback?: string
}

const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(
    ({ src, alt, size = 40, className, fallback }, ref) => {
        const [errored, setErrored] = React.useState(false)

        const initials = fallback || alt?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || "?"

        return (
            <div
                ref={ref}
                className={cn(
                    "relative shrink-0 overflow-hidden rounded-full bg-primary",
                    className
                )}
                style={{ width: size, height: size }}
            >
                {src && !errored ? (
                    <img
                        src={src}
                        alt={alt || "Avatar"}
                        className="h-full w-full object-cover"
                        onError={() => setErrored(true)}
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-primary-foreground font-semibold text-sm">
                        {initials}
                    </div>
                )}
            </div>
        )
    }
)
Avatar.displayName = "Avatar"

export { Avatar }
export type { AvatarProps }
