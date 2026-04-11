import { cn } from "@/lib/utils"
import { FieldDescription } from "@/components/ui/field"

/**
 * Reusable auth screen wrapper.
 *
 * Renders: {children} -> {footer}
 * Logo and terms are handled by the layout.
 */
export function AuthFormLayout({
    className,
    footer,
    children,
    ...props
}: React.ComponentProps<"div"> & {
    /** Content rendered below the form (e.g. social login buttons) */
    footer?: React.ReactNode
}) {
    return (
        <div className={cn("flex flex-col gap-6", className)} {...props}>
            {children}
            {footer}
        </div>
    )
}

/**
 * The standard header block: Title + Description.
 * Logo is rendered by the layout, not here.
 */
export function AuthFormHeader({
    title,
    description,
}: {
    title: string
    description?: React.ReactNode
}) {
    return (
        <div className="flex flex-col gap-2 max-w-[90%]">
            <h1 className="text-5xl font-extrabold tracking-tight">{title}</h1>
            {description && (
                <FieldDescription className="text-lg">
                    {description}
                </FieldDescription>
            )}
        </div>
    )
}

/**
 * Terms of Service / Privacy Policy footer — used by the layout.
 */
export function TermsFooter({ className }: { className?: string }) {
    return (
        <FieldDescription className={cn("px-6 text-center", className)}>
            By clicking continue, you agree to our{" "}
            <a href="https://oxy.so/company/transparency/policies/terms-of-service">
                Terms of Service
            </a>{" "}
            and{" "}
            <a href="https://oxy.so/company/transparency/policies/privacy">
                Privacy Policy
            </a>
            .
        </FieldDescription>
    )
}

/**
 * Shared loading spinner used across auth screens.
 */
export function LoadingSpinner({ className }: { className?: string }) {
    return (
        <div
            className={cn(
                "flex flex-col gap-6 items-center justify-center min-h-[300px]",
                className
            )}
        >
            <div className="auth-loading-morph" />
        </div>
    )
}

/**
 * Detect whether the current window is a popup (opened by another window).
 */
export function isPopupWindow(): boolean {
    try {
        return !!window.opener && window.opener !== window
    } catch {
        return false
    }
}

/**
 * Attempt to close the popup window. Returns true if close was attempted.
 */
export function tryClosePopup(): boolean {
    if (isPopupWindow()) {
        window.close()
        return true
    }
    return false
}
