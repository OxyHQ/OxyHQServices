/**
 * Tests for `useHoverColorPreset`: handlers apply + restore the scoped preset,
 * reduced-motion suppresses the global transition style, and unmount tears the
 * scope down.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { __setReducedMotionForTests } from "./setup-dom"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useHoverColorPreset } from "@/lib/use-hover-color-preset"
import { __resetBloomCSSForTests, setBasePreset } from "@/lib/bloom-css"

type HookHandle<T> = { current: T | null }

function renderHook<T>(hook: () => T): { result: HookHandle<T>; root: Root; container: HTMLDivElement; rerender: () => void; unmount: () => void } {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const result: HookHandle<T> = { current: null }

    function HookHost() {
        result.current = hook()
        return null
    }

    const root = createRoot(container)
    act(() => {
        root.render(<HookHost />)
    })

    return {
        result,
        root,
        container,
        rerender: () => {
            act(() => {
                root.render(<HookHost />)
            })
        },
        unmount: () => {
            act(() => {
                root.unmount()
            })
            container.remove()
        },
    }
}

function styleEl(scope: string): HTMLStyleElement | null {
    const el = document.getElementById(`bloom-color-preset-${scope}`)
    return el instanceof HTMLStyleElement ? el : null
}

describe("useHoverColorPreset", () => {
    beforeEach(() => {
        __resetBloomCSSForTests()
        __setReducedMotionForTests(false)
        document.getElementById("bloom-color-preset-transition")?.remove()
    })

    test("apply + restore wire to the scoped style block", () => {
        setBasePreset("oxy")
        const { result, unmount } = renderHook(() => useHoverColorPreset("chooser-hover"))

        expect(result.current).not.toBeNull()
        act(() => {
            result.current?.apply("blue")
        })
        expect(styleEl("chooser-hover")).not.toBeNull()

        act(() => {
            result.current?.restore()
        })
        expect(styleEl("chooser-hover")).toBeNull()
        // base scope is still in place.
        expect(styleEl("base")).not.toBeNull()
        unmount()
    })

    test("getHandlers returns mouse + focus handlers that apply / restore", () => {
        setBasePreset("oxy")
        const { result, unmount } = renderHook(() => useHoverColorPreset("chooser-hover"))

        const handlers = result.current?.getHandlers("blue")
        expect(handlers).toBeDefined()
        if (!handlers) {
            unmount()
            return
        }

        act(() => handlers.onMouseEnter())
        expect(styleEl("chooser-hover")).not.toBeNull()
        act(() => handlers.onMouseLeave())
        expect(styleEl("chooser-hover")).toBeNull()

        act(() => handlers.onFocus())
        expect(styleEl("chooser-hover")).not.toBeNull()
        act(() => handlers.onBlur())
        expect(styleEl("chooser-hover")).toBeNull()

        unmount()
    })

    test("apply with empty / null preset is a no-op", () => {
        const { result, unmount } = renderHook(() => useHoverColorPreset("chooser-hover"))

        act(() => result.current?.apply(null))
        expect(styleEl("chooser-hover")).toBeNull()
        act(() => result.current?.apply(undefined))
        expect(styleEl("chooser-hover")).toBeNull()
        act(() => result.current?.apply(""))
        expect(styleEl("chooser-hover")).toBeNull()
        unmount()
    })

    test("apply injects the transition style by default", () => {
        const { result, unmount } = renderHook(() => useHoverColorPreset("chooser-hover"))
        act(() => result.current?.apply("blue"))
        expect(document.getElementById("bloom-color-preset-transition")).not.toBeNull()
        unmount()
    })

    test("reduced-motion suppresses the transition style", () => {
        __setReducedMotionForTests(true)
        const { result, unmount } = renderHook(() => useHoverColorPreset("chooser-hover"))
        act(() => result.current?.apply("blue"))
        expect(document.getElementById("bloom-color-preset-transition")).toBeNull()
        unmount()
    })

    test("unmount releases the scope (cleanup)", () => {
        setBasePreset("oxy")
        const { result, unmount } = renderHook(() => useHoverColorPreset("chooser-hover"))
        act(() => result.current?.apply("blue"))
        expect(styleEl("chooser-hover")).not.toBeNull()
        unmount()
        expect(styleEl("chooser-hover")).toBeNull()
        expect(styleEl("base")).not.toBeNull()
    })
})
