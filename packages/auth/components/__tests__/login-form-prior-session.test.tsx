/**
 * The login form threads the browser's active device session as
 * `priorSessionId` on the sign-in request, so the API joins the newly
 * authenticated account to the SAME central device instead of sprawling a fresh
 * one. The id is the value `useDeviceAccounts` already resolved from the
 * device's refresh cookies; when no account is signed in, the field is omitted.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import * as coreActual from "@oxyhq/core"

// The chooser is skipped and the form drives straight to the password step via
// `loginHint`. `currentSessionId` is mutated per-test through this closure.
let deviceAccountsState: {
    isLoading: boolean
    currentSessionId: string | null
    accounts: unknown[]
} = { isLoading: false, currentSessionId: null, accounts: [] }

mock.module("@/lib/use-device-accounts", () => ({
    useDeviceAccounts: () => deviceAccountsState,
}))

// A controllable username lookup so the identifier→password transition resolves
// without touching the network. Spread the real module so co-running test files
// keep the genuine core exports (bun's mock.module is process-global) — we only
// override `OxyServices`.
mock.module("@oxyhq/core", () => ({
    ...coreActual,
    OxyServices: class {
        async lookupUsername() {
            return { exists: true, username: "bob", name: { displayName: "Bob" }, avatar: null, color: null }
        }
    },
}))

mock.module("@/lib/device-fingerprint", () => ({
    getOrCreateDeviceFingerprint: async () => "fp-1",
}))

const { LoginForm } = await import("@/components/login-form")

let loginBody: Record<string, unknown> | null = null
const originalFetch = globalThis.fetch

beforeEach(() => {
    loginBody = null
    deviceAccountsState = { isLoading: false, currentSessionId: null, accounts: [] }
    // Re-assert the mutable mocks each test (bun's mock.module is process-global).
    mock.module("@/lib/use-device-accounts", () => ({
        useDeviceAccounts: () => deviceAccountsState,
    }))
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input)
        if (url.includes("/auth/login")) {
            loginBody = JSON.parse(String(init?.body ?? "{}"))
            // Return no sessionId so the form settles on the identifier/password
            // step without entering the post-login redirect (which would need the
            // real auth-utils / FedCM handoff). The request body — already
            // captured above — is all this test asserts.
            return Promise.resolve(
                new Response(JSON.stringify({}), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            )
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200 }))
    }) as typeof fetch
})

afterEach(() => {
    globalThis.fetch = originalFetch
})

function renderForm(): { container: HTMLDivElement; root: Root } {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    act(() => {
        root.render(
            <BrowserRouter>
                <LoginForm loginHint="bob" />
            </BrowserRouter>,
        )
    })
    return { container, root }
}

async function flush(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

async function submitPassword(container: HTMLElement): Promise<void> {
    // Advance from the auto-run lookup to the password step.
    await flush()
    const password = container.querySelector<HTMLInputElement>('input[name="password"]')
    if (!password) throw new Error("password step did not render")
    password.value = "correct horse"
    const form = password.closest("form")
    if (!form) throw new Error("password form not found")
    await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await flush()
}

describe("LoginForm — priorSessionId threading", () => {
    test("includes priorSessionId when an account is signed in on the device", async () => {
        deviceAccountsState = { isLoading: false, currentSessionId: "prior-session-xyz", accounts: [] }
        const { container, root } = renderForm()

        await submitPassword(container)

        expect(loginBody).not.toBeNull()
        expect(loginBody?.priorSessionId).toBe("prior-session-xyz")
        expect(loginBody?.deviceFingerprint).toBe("fp-1")

        act(() => root.unmount())
        container.remove()
    })

    test("omits priorSessionId when no account is signed in", async () => {
        deviceAccountsState = { isLoading: false, currentSessionId: null, accounts: [] }
        const { container, root } = renderForm()

        await submitPassword(container)

        expect(loginBody).not.toBeNull()
        expect(loginBody).not.toHaveProperty("priorSessionId")

        act(() => root.unmount())
        container.remove()
    })
})
