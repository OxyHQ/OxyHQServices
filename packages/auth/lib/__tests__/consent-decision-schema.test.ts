/**
 * Contract tests for `consentDecisionSchema` + `consentRequiredFromBody` — the
 * `GET /auth/oauth/consent` decision the authorize page runs to decide whether
 * the OAuth ConsentCard must be shown or the request can be auto-approved.
 *
 * The page calls this for the OAuth code path right after an account is
 * selected. The security-critical invariant: ANY response the schema cannot
 * validate (transport failure, malformed body, missing field, unknown `reason`)
 * MUST fail safe to `consentRequired: true` so the ConsentCard is shown — we
 * never silently auto-approve on a parse error.
 */
import { describe, expect, test } from "bun:test"
import {
    consentDecisionSchema,
    consentRequiredFromBody,
    safeParse,
} from "@/lib/schemas"

describe("consentDecisionSchema", () => {
    test("parses every valid reason", () => {
        for (const reason of ["trusted", "granted", "new", "scope_changed"]) {
            const parsed = safeParse(consentDecisionSchema, {
                consentRequired: reason === "new" || reason === "scope_changed",
                reason,
            })
            expect(parsed).not.toBeNull()
            expect(parsed?.reason).toBe(
                reason as "trusted" | "granted" | "new" | "scope_changed"
            )
        }
    })

    test("rejects an unknown reason enum value", () => {
        expect(
            safeParse(consentDecisionSchema, {
                consentRequired: false,
                reason: "because_i_said_so",
            })
        ).toBeNull()
    })

    test("rejects a missing consentRequired field", () => {
        expect(
            safeParse(consentDecisionSchema, { reason: "trusted" })
        ).toBeNull()
    })

    test("rejects a non-boolean consentRequired", () => {
        expect(
            safeParse(consentDecisionSchema, {
                consentRequired: "false",
                reason: "trusted",
            })
        ).toBeNull()
    })
})

describe("consentRequiredFromBody", () => {
    test("unwraps the API `{ data: { ... } }` envelope (trusted → auto-approve)", () => {
        expect(
            consentRequiredFromBody({
                data: { consentRequired: false, reason: "trusted" },
            })
        ).toBe(false)
    })

    test("unwraps a covering grant (granted → auto-approve)", () => {
        expect(
            consentRequiredFromBody({
                data: { consentRequired: false, reason: "granted" },
            })
        ).toBe(false)
    })

    test("requires consent for a new app", () => {
        expect(
            consentRequiredFromBody({
                data: { consentRequired: true, reason: "new" },
            })
        ).toBe(true)
    })

    test("requires consent when scopes changed", () => {
        expect(
            consentRequiredFromBody({
                data: { consentRequired: true, reason: "scope_changed" },
            })
        ).toBe(true)
    })

    test("accepts a bare (unwrapped) decision object", () => {
        expect(
            consentRequiredFromBody({
                consentRequired: false,
                reason: "trusted",
            })
        ).toBe(false)
    })

    // ---- fail-safe: never auto-approve on a body the schema can't validate ----

    test("fails safe to true for null", () => {
        expect(consentRequiredFromBody(null)).toBe(true)
    })

    test("fails safe to true for undefined", () => {
        expect(consentRequiredFromBody(undefined)).toBe(true)
    })

    test("fails safe to true for an empty object", () => {
        expect(consentRequiredFromBody({})).toBe(true)
    })

    test("fails safe to true for an empty data envelope", () => {
        expect(consentRequiredFromBody({ data: {} })).toBe(true)
    })

    test("fails safe to true for an unknown reason", () => {
        expect(
            consentRequiredFromBody({
                data: { consentRequired: false, reason: "mystery" },
            })
        ).toBe(true)
    })

    test("fails safe to true for a non-object body", () => {
        expect(consentRequiredFromBody("not json")).toBe(true)
        expect(consentRequiredFromBody(42)).toBe(true)
    })
})
