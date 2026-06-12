/**
 * Hover/focus color-preset hook for the account chooser.
 *
 * On `mouseenter` / `focus` we layer the hovered account's Bloom preset on top
 * of the base preset via a transient scoped style block; on `mouseleave` /
 * `blur` (and on unmount) we tear that scope down so the base theme bleeds
 * back through. The hook is keyboard-aware: focus/blur on the same target
 * mirrors the pointer handlers so users navigating with Tab see the same
 * branding as users hovering with the mouse.
 */
import { useCallback, useEffect, useMemo, useRef } from "react"
import { applyColorPreset, restoreBasePreset } from "@/lib/bloom-css"

type HoverHandlers = {
    onMouseEnter: () => void
    onMouseLeave: () => void
    onFocus: () => void
    onBlur: () => void
}

type UseHoverColorPresetReturn = {
    /** Apply the given preset to the hook's scope. No-op for empty / unknown. */
    apply: (preset: string | null | undefined) => void
    /** Tear the scope down so the base preset is the only thing applied. */
    restore: () => void
    /**
     * Curry a set of DOM event handlers for a chooser row. Wire the returned
     * object onto the row's `<button>` to enable pointer + keyboard theming.
     */
    getHandlers: (preset: string | null | undefined) => HoverHandlers
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)"

function prefersReducedMotion(): boolean {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false
    }
    return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

const TRANSITION_STYLE_ID = "bloom-color-preset-transition"
const TRANSITION_CSS = `:root {\n  transition: color 200ms ease, background-color 200ms ease, border-color 200ms ease, fill 200ms ease, stroke 200ms ease;\n}`

function ensureTransitionStyle(): void {
    if (typeof document === "undefined") return
    if (prefersReducedMotion()) {
        const existing = document.getElementById(TRANSITION_STYLE_ID)
        if (existing) existing.remove()
        return
    }
    if (document.getElementById(TRANSITION_STYLE_ID)) return
    const el = document.createElement("style")
    el.id = TRANSITION_STYLE_ID
    el.textContent = TRANSITION_CSS
    document.head.appendChild(el)
}

export function useHoverColorPreset(
    scope: string = "chooser-hover"
): UseHoverColorPresetReturn {
    const scopeRef = useRef(scope)
    scopeRef.current = scope

    const apply = useCallback((preset: string | null | undefined) => {
        if (!preset) return
        ensureTransitionStyle()
        applyColorPreset(preset, scopeRef.current)
    }, [])

    const restore = useCallback(() => {
        restoreBasePreset(scopeRef.current)
    }, [])

    // Release the transient scope when the consumer unmounts. This is a
    // legitimate use of useEffect: cleanup of a DOM resource owned by the hook.
    useEffect(() => {
        return () => {
            restoreBasePreset(scopeRef.current)
        }
    }, [])

    const getHandlers = useCallback(
        (preset: string | null | undefined): HoverHandlers => ({
            onMouseEnter: () => apply(preset),
            onMouseLeave: () => restore(),
            onFocus: () => apply(preset),
            onBlur: () => restore(),
        }),
        [apply, restore]
    )

    return useMemo(
        () => ({ apply, restore, getHandlers }),
        [apply, restore, getHandlers]
    )
}
