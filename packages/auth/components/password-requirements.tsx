import { cn } from "@/lib/utils"
import { PASSWORD_RULES } from "@/lib/password-validation"

export function PasswordRequirements({ password }: { password: string }) {
    return (
        <ul className="mt-1.5 space-y-1 text-xs">
            {PASSWORD_RULES.map((rule) => {
                const passes = rule.test(password)
                return (
                    <li
                        key={rule.label}
                        className={cn(
                            "flex items-center gap-1.5",
                            passes
                                ? "text-green-600 dark:text-green-400"
                                : "text-muted-foreground"
                        )}
                    >
                        {passes ? (
                            <svg
                                className="h-3 w-3 shrink-0"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                            >
                                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z" />
                            </svg>
                        ) : (
                            <svg
                                className="h-3 w-3 shrink-0"
                                viewBox="0 0 16 16"
                                fill="currentColor"
                            >
                                <circle cx="8" cy="8" r="3" />
                            </svg>
                        )}
                        {rule.label}
                    </li>
                )
            })}
        </ul>
    )
}
