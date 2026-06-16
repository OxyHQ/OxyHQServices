/**
 * Web-layer tests for `<AppIdentityCard>` — the consent-screen header that
 * resolves and DISPLAYS the real requesting application's identity.
 *
 * Coverage:
 *   - official first-party app → app name + an "official Oxy application" trust
 *     line; NO third-party developer / website line.
 *   - internal app (isInternal) → "internal Oxy application" presentation.
 *   - third-party app (isOfficial false, with developerName + websiteUrl) →
 *     developer name + website link; NO official trust line.
 *   - requested scopes render human-readable labels from `scope-labels`; an
 *     explicit `requestedScopes` prop OVERRIDES the application's own `scopes`.
 *
 * `Avatar` is stubbed to a web-safe surrogate by `setup-mocks.ts` (it otherwise
 * pulls `react-native`, which bun cannot parse in this node test environment).
 */
import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { PublicApplication } from "@oxyhq/core"
import { AppIdentityCard } from "@/components/app-identity-card"
import { SCOPE_LABELS } from "@/lib/scope-labels"

type Rendered = { container: HTMLDivElement; unmount: () => void }

function renderCard(
    app: PublicApplication,
    requestedScopes?: readonly string[]
): Rendered {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root: Root = createRoot(container)
    act(() => {
        root.render(
            <AppIdentityCard app={app} requestedScopes={requestedScopes} />
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

const officialFirstParty: PublicApplication = {
    id: "app_official",
    name: "Mention",
    type: "first_party",
    isOfficial: true,
    isInternal: false,
    scopes: ["user:read"],
    developerName: "Oxy",
    websiteUrl: "https://mention.earth",
}

const internalApp: PublicApplication = {
    id: "app_internal",
    name: "Oxy Console",
    type: "internal",
    isOfficial: true,
    isInternal: true,
    scopes: ["user:read"],
}

const thirdPartyApp: PublicApplication = {
    id: "app_third",
    name: "Acme Widgets",
    type: "third_party",
    isOfficial: false,
    isInternal: false,
    scopes: ["files:read"],
    developerName: "Acme Inc.",
    websiteUrl: "https://acme.example.com",
}

describe("AppIdentityCard", () => {
    // Each test calls `unmount()`, which removes its own container from the DOM,
    // so no global teardown is needed — there is no leaked markup to clear.

    test("official first-party app shows the name + official trust line, no developer/website line", () => {
        const { container, unmount } = renderCard(officialFirstParty)
        const text = container.textContent ?? ""

        expect(text).toContain("Continue to Mention")
        expect(text).toContain("Mention is an official Oxy application.")
        expect(text).not.toContain("internal Oxy application")
        // Third-party-only affordances must NOT render for an official app.
        expect(text).not.toContain("by Oxy")
        expect(container.querySelector("a[href]")).toBeNull()

        unmount()
    })

    test("internal app shows the internal Oxy application presentation", () => {
        const { container, unmount } = renderCard(internalApp)
        const text = container.textContent ?? ""

        expect(text).toContain("Oxy Console is an internal Oxy application.")
        expect(text).not.toContain("official Oxy application")
        expect(container.querySelector("a[href]")).toBeNull()

        unmount()
    })

    test("third-party app shows developer name + website link, no official trust line", () => {
        const { container, unmount } = renderCard(thirdPartyApp)
        const text = container.textContent ?? ""

        expect(text).toContain("Continue to Acme Widgets")
        expect(text).toContain("Acme Inc.")
        expect(text).not.toContain("official Oxy application")
        expect(text).not.toContain("internal Oxy application")

        // Website link renders to the configured URL with safe rel/target.
        const link = container.querySelector("a[href]")
        expect(link).not.toBeNull()
        expect(link?.getAttribute("href")).toBe("https://acme.example.com")
        expect(link?.getAttribute("rel")).toContain("noopener")
        expect(link?.getAttribute("target")).toBe("_blank")
        // Hostname is the display label, not the raw URL.
        expect(link?.textContent).toContain("acme.example.com")

        unmount()
    })

    test("requested scopes render human-readable labels (not raw scope strings)", () => {
        const { container, unmount } = renderCard(thirdPartyApp, ["files:read"])
        const text = container.textContent ?? ""

        expect(text).toContain(SCOPE_LABELS["files:read"])
        // The raw scope token must never be shown to the user when a label exists.
        expect(text).not.toContain("files:read")

        unmount()
    })

    test("explicit requestedScopes OVERRIDE the application's own scopes", () => {
        // App is configured for `user:read`, but the OAuth request asks for
        // `files:write` — the card must display the REQUESTED scope's label and
        // not the application's configured one.
        const { container, unmount } = renderCard(officialFirstParty, [
            "files:write",
        ])
        const text = container.textContent ?? ""

        expect(text).toContain(SCOPE_LABELS["files:write"])
        expect(text).not.toContain(SCOPE_LABELS["user:read"])

        unmount()
    })

    test("falls back to the application's own scopes when no requestedScopes are given", () => {
        const { container, unmount } = renderCard(officialFirstParty)
        const text = container.textContent ?? ""

        expect(text).toContain(SCOPE_LABELS["user:read"])

        unmount()
    })
})
