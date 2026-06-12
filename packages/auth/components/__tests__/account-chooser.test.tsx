/**
 * Integration test: hovering / focusing a chooser row layers the row's Bloom
 * color preset over the base theme; leaving / blurring tears it back down.
 * Rows whose account has no color (null / undefined) must NOT apply anything.
 */
import { beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { AccountChooser } from "@/components/account-chooser"
import { __resetBloomCSSForTests, setBasePreset } from "@/lib/bloom-css"
import type { DeviceAccount } from "@/lib/types"

function styleEl(scope: string): HTMLStyleElement | null {
    const el = document.getElementById(`bloom-color-preset-${scope}`)
    return el instanceof HTMLStyleElement ? el : null
}

function dispatchMouse(target: Element, type: "mouseover" | "mouseout"): void {
    // React synthesizes `onMouseEnter` / `onMouseLeave` from native
    // `mouseover` / `mouseout` events bubbled to its delegated root, then
    // filters them with `relatedTarget` to suppress re-entry within the same
    // subtree. Dispatching `mouseenter` / `mouseleave` directly is a no-op
    // through the React delegated listener — these tests must use the bubbling
    // base events instead.
    const evt = new (window.MouseEvent || Event)(type, {
        bubbles: true,
        cancelable: true,
    })
    target.dispatchEvent(evt)
}

type Rendered = { root: Root; container: HTMLDivElement; unmount: () => void }

function renderChooser(accounts: DeviceAccount[]): Rendered {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
        root.render(
            <BrowserRouter>
                <AccountChooser
                    accounts={accounts}
                    onSelectAccount={() => undefined}
                    onUseAnother={() => undefined}
                />
            </BrowserRouter>
        )
    })
    return {
        root,
        container,
        unmount: () => {
            act(() => root.unmount())
            container.remove()
        },
    }
}

describe("AccountChooser hover theming", () => {
    beforeEach(() => {
        __resetBloomCSSForTests()
        document.getElementById("bloom-color-preset-transition")?.remove()
        setBasePreset("oxy")
    })

    test("mouseenter on a colored row applies its preset, mouseleave restores", () => {
        const accounts: DeviceAccount[] = [
            {
                sessionId: "s1",
                isCurrent: true,
                account: { id: "u1", username: "alice", displayName: "Alice", color: "blue" },
            },
            {
                sessionId: "s2",
                isCurrent: false,
                account: { id: "u2", username: "bob", displayName: "Bob", color: null },
            },
        ]
        const { container, unmount } = renderChooser(accounts)

        const buttons = container.querySelectorAll("button")
        // First two buttons are the accounts; the third is "Use a different account".
        expect(buttons.length).toBeGreaterThanOrEqual(2)
        const aliceBtn = buttons[0]
        const bobBtn = buttons[1]

        act(() => dispatchMouse(aliceBtn, "mouseover"))
        expect(styleEl("chooser-hover")).not.toBeNull()

        act(() => dispatchMouse(aliceBtn, "mouseout"))
        expect(styleEl("chooser-hover")).toBeNull()
        expect(styleEl("base")).not.toBeNull()

        // Colorless row: mouseover must NOT inject anything; mouseout is still
        // a defensive restore (idempotent).
        act(() => dispatchMouse(bobBtn, "mouseover"))
        expect(styleEl("chooser-hover")).toBeNull()
        act(() => dispatchMouse(bobBtn, "mouseout"))
        expect(styleEl("chooser-hover")).toBeNull()
        expect(styleEl("base")).not.toBeNull()

        unmount()
    })

    test("focus / blur mirror mouseenter / mouseleave for keyboard users", () => {
        const accounts: DeviceAccount[] = [
            {
                sessionId: "s1",
                isCurrent: true,
                account: { id: "u1", username: "alice", color: "purple" },
            },
        ]
        const { container, unmount } = renderChooser(accounts)
        const btn = container.querySelector("button")
        if (!btn) throw new Error("missing button")

        act(() => btn.dispatchEvent(new (window.FocusEvent || Event)("focus", { bubbles: false })))
        // jsdom doesn't bubble focus reliably — fall back to focusin which React
        // listens to internally for the synthetic `onFocus`.
        act(() => btn.dispatchEvent(new (window.FocusEvent || Event)("focusin", { bubbles: true })))
        expect(styleEl("chooser-hover")).not.toBeNull()

        act(() => btn.dispatchEvent(new (window.FocusEvent || Event)("focusout", { bubbles: true })))
        expect(styleEl("chooser-hover")).toBeNull()

        unmount()
    })

    test("unmount cleans the chooser-hover scope up", () => {
        const accounts: DeviceAccount[] = [
            {
                sessionId: "s1",
                isCurrent: true,
                account: { id: "u1", username: "alice", color: "blue" },
            },
        ]
        const { container, unmount } = renderChooser(accounts)
        const btn = container.querySelector("button")
        if (!btn) throw new Error("missing button")
        act(() => dispatchMouse(btn, "mouseover"))
        expect(styleEl("chooser-hover")).not.toBeNull()
        unmount()
        expect(styleEl("chooser-hover")).toBeNull()
    })
})
