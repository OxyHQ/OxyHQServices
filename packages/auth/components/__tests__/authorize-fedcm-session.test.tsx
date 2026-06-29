/**
 * The authorize page plants the central `fedcm_session` cookie when a device-flow
 * "Sign in with Oxy" request is APPROVED in the first-party IdP browser context.
 *
 * Why: the device-flow handoff mints the relying party's bearer via the `claim`
 * exchange, which establishes NO IdP browser session. A returning user who
 * reached consent via the account chooser never passed through `/login`, so the
 * central `fedcm_session` cookie was never planted — and on a cross-apex RP that
 * cookie is the ONLY anchor the cross-domain cold-boot restore can read on
 * reload. So on a successful approve we call `registerFedCMSession` with the
 * approving user's OWN validated session id (same-origin to this IdP host; the
 * existing `/fedcm/set-session` same-origin guard + server-side validation still
 * apply).
 *
 * This test stubs the consent / chooser UI (their rendering is their own
 * concern) and asserts only the page's decision wiring: approving the device
 * flow POSTs `/session/authorize/:token` AND THEN `/fedcm/set-session` with the
 * chosen account's session id.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { MemoryRouter, Route, Routes } from "react-router-dom"

mock.module("@/lib/i18n/use-translation", () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

// A single device account the page lists in the chooser; selecting it plants
// the bearer the approve step needs.
const deviceAccount = {
    sessionId: "user-sess-1",
    isCurrent: true,
    accessToken: "bearer-1",
    authuser: 0,
    account: { id: "u1", username: "alice" },
}
mock.module("@/lib/use-device-accounts", () => ({
    useDeviceAccounts: () => ({
        accounts: [deviceAccount],
        currentSessionId: "user-sess-1",
        isLoading: false,
    }),
}))

// Stub ONLY the consent card with a single "approve" button wired to the page's
// real `onDecision`, so the test exercises the page's decision flow, not consent
// UI. The chooser is left REAL (clicking its first row selects the device
// account — the returning-user path — which plants the chosen bearer); mocking
// `@/components/account-chooser` here would leak process-globally in bun and
// break `account-chooser.test.tsx`.
mock.module("@/components/consent-card", () => ({
    ConsentCard: ({
        onDecision,
        showActions,
    }: {
        onDecision: (decision: "approve" | "deny") => void
        showActions: boolean
    }) =>
        showActions ? (
            <button type="button" onClick={() => onDecision("approve")}>
                approve
            </button>
        ) : null,
}))

const { AuthorizePage } = await import("@/src/pages/authorize")

type FetchCall = { url: string; init?: RequestInit }
const originalFetch = globalThis.fetch

function installFetch(calls: FetchCall[]): void {
    const json = (body: unknown): Response =>
        new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
        })
    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString()
        calls.push({ url, init })
        if (url.includes("/session/status/")) {
            return json({
                data: {
                    status: "pending",
                    sessionId: "auth-sess",
                    application: {
                        id: "app1",
                        name: "Test App",
                        type: "first_party",
                        isOfficial: true,
                        isInternal: false,
                        scopes: ["basic"],
                    },
                },
            })
        }
        return json({ success: true })
    }) as typeof fetch
}

function render(): { container: HTMLDivElement; unmount: () => void } {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => {
        root.render(
            <MemoryRouter initialEntries={["/authorize?token=tok123"]}>
                <Routes>
                    <Route path="/authorize" element={<AuthorizePage />} />
                </Routes>
            </MemoryRouter>,
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

async function flushUntil(cond: () => boolean, label: string): Promise<void> {
    for (let i = 0; i < 50; i++) {
        if (cond()) return
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
    throw new Error(`Timed out waiting for: ${label}`)
}

describe("AuthorizePage — device-flow approve plants fedcm_session", () => {
    let calls: FetchCall[]

    beforeEach(() => {
        calls = []
        installFetch(calls)
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    test("approving the device flow POSTs /fedcm/set-session with the approving user's session id", async () => {
        const { container, unmount } = render()

        const buttons = (): HTMLButtonElement[] => Array.from(container.querySelectorAll("button"))
        const findButton = (label: RegExp): HTMLButtonElement | undefined =>
            buttons().find((b) => label.test(b.textContent ?? ""))

        // After the status loads, the account chooser appears (the user has a
        // device session). Selecting the account — the returning-user path —
        // plants its bearer and reveals consent. The chooser renders the account
        // rows first, so the first button selects the device account.
        await flushUntil(() => buttons().length > 0 && findButton(/approve/i) === undefined, "account chooser")
        await act(async () => {
            buttons()[0]?.click()
        })

        await flushUntil(() => findButton(/approve/i) !== undefined, "consent approve button")
        await act(async () => {
            findButton(/approve/i)?.click()
        })

        await flushUntil(
            () => calls.some((c) => c.url.includes("/fedcm/set-session")),
            "/fedcm/set-session call",
        )

        // The device flow was authorized first, then the session cookie planted.
        expect(calls.some((c) => c.url.includes("/session/authorize/tok123"))).toBe(true)

        const setSession = calls.find((c) => c.url.includes("/fedcm/set-session"))
        if (!setSession) throw new Error("missing /fedcm/set-session call")
        const body = JSON.parse(String(setSession.init?.body)) as { sessionId?: string; action?: string }
        expect(body.sessionId).toBe("user-sess-1")
        expect(body.action).toBe("login")

        unmount()
    })
})
