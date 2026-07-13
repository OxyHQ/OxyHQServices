/**
 * When the server flags a committed sign-in as anomalous, the login form shows a
 * "New sign-in detected" acknowledgement. The "That wasn't me" button must
 * REVOKE the just-committed device session via the SDK
 * (`useOxy().revokeSuspiciousSignIn()`) — which server-revokes the session and
 * clears the local zero-cookie device credential — before returning to the
 * identifier step. It must NOT merely navigate back without revoking.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"

const revokeSuspiciousSignIn = mock(async () => undefined)
const signInWithPassword = mock(async () => ({
    status: "ok" as const,
    securityAlert: {
        message: "We noticed a sign-in from a device we don't recognize.",
        anomalies: [{ type: "new_device", reason: "Login from new device" }],
    },
}))

// `loginHint` routes the form straight to the password step for a known account
// (bypassing the controlled identifier input), so the test can drive the
// password → security-alert → repudiate path deterministically. The lookup
// returns a plain account (no color/avatar branding side effects).
mock.module("@oxyhq/services", () => ({
    useOxy: () => ({
        openAccountDialog: () => undefined,
        oxyServices: {
            lookupUsername: async () => ({
                username: "alice",
                name: { displayName: "Alice" },
                avatar: null,
                color: null,
            }),
        },
        signInWithPassword,
        completeTwoFactorSignIn: async () => ({}),
        revokeSuspiciousSignIn,
        switchToAccount: async () => undefined,
    }),
    useSwitchableAccounts: () => ({ isLoading: false, currentSessionId: null, accounts: [] }),
}))

const { LoginForm } = await import("@/components/login-form")

function renderForm(): { container: HTMLDivElement; unmount: () => void } {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => {
        root.render(
            <BrowserRouter>
                <LoginForm loginHint="alice" />
            </BrowserRouter>,
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

/** Drain queued microtasks + timers (lookup / sign-in / revoke promises) and let React re-render. */
async function flush(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

function findButton(container: HTMLElement, label: RegExp): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find((b) =>
        label.test(b.textContent ?? ""),
    )
}

describe("LoginForm — security alert repudiation", () => {
    beforeEach(() => {
        revokeSuspiciousSignIn.mockClear()
        signInWithPassword.mockClear()
    })

    test("'That wasn't me' revokes the sign-in via the SDK and returns to the identifier step", async () => {
        const { container, unmount } = renderForm()

        // loginHint auto-advances to the password step.
        await flush()
        const password = container.querySelector<HTMLInputElement>("#password")
        if (!password) throw new Error("expected the password input to be present")

        // Submit the password → server returns a flagged session.
        password.value = "hunter2-correct-horse"
        const form = password.closest("form")
        if (!form) throw new Error("expected the password input to be within a form")
        act(() => {
            form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))
        })
        await flush()

        expect(signInWithPassword).toHaveBeenCalledTimes(1)

        // The security-alert interstitial is shown.
        const denyButton = findButton(container, /that wasn.?t me/i)
        expect(denyButton).toBeDefined()
        expect(container.textContent).toContain("New sign-in detected")

        // Repudiate → must revoke through the SDK, not just navigate back.
        act(() => {
            denyButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }))
        })
        await flush()

        expect(revokeSuspiciousSignIn).toHaveBeenCalledTimes(1)

        // Back on the identifier step (the revoked account is gone).
        expect(container.querySelector("#identifier")).not.toBeNull()
        expect(findButton(container, /that wasn.?t me/i)).toBeUndefined()

        unmount()
    })
})
