/**
 * Renders the IdP "Sign in with Oxy" (QR) screen across its phases. The flow
 * controller (`@/lib/use-commons-signin`) is mocked so the component renders
 * deterministic states without network / qrcode / canvas.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { OxyServices } from "@oxyhq/core"

type HookReturn = {
    phase: string
    qrPayload: string | null
    qrImageDataUrl: string | null
    expiresAt: number | null
    error: string | null
    start: () => void
    reset: () => void
}

let hookReturn: HookReturn

// Registered BEFORE the dynamic component import below so the component binds to
// the stub. Mirrors the `mock.module` pattern in `setup-mocks.ts`.
mock.module("@/lib/use-commons-signin", () => ({
    useCommonsSignIn: () => hookReturn,
}))

const { CommonsSignIn } = await import("@/components/commons-signin")

type Rendered = { container: HTMLDivElement; unmount: () => void }

function renderScreen(onAuthorized = () => undefined, onBack = () => undefined): Rendered {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => {
        root.render(
            <CommonsSignIn
                oxyServices={{} as unknown as OxyServices}
                clientId="oxy_dk_test"
                onAuthorized={onAuthorized}
                onBack={onBack}
            />,
        )
    })
    return {
        container,
        unmount: () => {
            act(() => root.unmount())
            container.remove()
        },
    }
}

function baseHook(): HookReturn {
    return {
        phase: "starting",
        qrPayload: null,
        qrImageDataUrl: null,
        expiresAt: null,
        error: null,
        start: () => undefined,
        reset: () => undefined,
    }
}

describe("CommonsSignIn", () => {
    beforeEach(() => {
        hookReturn = baseHook()
    })

    test("renders the QR image while waiting for approval", () => {
        hookReturn = {
            ...baseHook(),
            phase: "waiting",
            qrPayload: "oxycommons://approve?v=1&code=code-1",
            qrImageDataUrl: "data:image/png;base64,QR",
        }
        const { container, unmount } = renderScreen()

        const img = container.querySelector("img")
        expect(img).not.toBeNull()
        expect(img?.getAttribute("src")).toBe("data:image/png;base64,QR")
        expect(img?.getAttribute("alt")).toBe("Sign in with Oxy QR code")
        expect(container.textContent).toContain("scan this code")
        unmount()
    })

    test("shows a signing-in state once authorized (no QR)", () => {
        hookReturn = { ...baseHook(), phase: "authorized" }
        const { container, unmount } = renderScreen()

        expect(container.querySelector("img")).toBeNull()
        expect(container.textContent).toContain("signing you in")
        unmount()
    })

    test("offers a fresh code when the session expired", () => {
        let started = 0
        hookReturn = { ...baseHook(), phase: "expired", start: () => { started += 1 } }
        const { container, unmount } = renderScreen()

        expect(container.textContent).toContain("expired")
        const buttons = Array.from(container.querySelectorAll("button"))
        const refresh = buttons.find((b) => /show a new code/i.test(b.textContent ?? ""))
        expect(refresh).toBeDefined()

        act(() => {
            refresh?.dispatchEvent(new (window.MouseEvent || Event)("click", { bubbles: true }))
        })
        expect(started).toBe(1)
        unmount()
    })

    test("surfaces an error with a retry action", () => {
        hookReturn = { ...baseHook(), phase: "error", error: "Network down" }
        const { container, unmount } = renderScreen()

        expect(container.textContent).toContain("Network down")
        const buttons = Array.from(container.querySelectorAll("button"))
        expect(buttons.some((b) => /try again/i.test(b.textContent ?? ""))).toBe(true)
        unmount()
    })

    test("Back invokes onBack", () => {
        let backed = 0
        hookReturn = { ...baseHook(), phase: "waiting", qrImageDataUrl: "data:image/png;base64,QR" }
        const { container, unmount } = renderScreen(() => undefined, () => { backed += 1 })

        const buttons = Array.from(container.querySelectorAll("button"))
        const back = buttons.find((b) => /back/i.test(b.textContent ?? ""))
        expect(back).toBeDefined()
        act(() => {
            back?.dispatchEvent(new (window.MouseEvent || Event)("click", { bubbles: true }))
        })
        expect(backed).toBe(1)
        unmount()
    })
})
