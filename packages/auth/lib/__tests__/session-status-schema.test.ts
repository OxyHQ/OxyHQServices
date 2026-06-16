/**
 * Contract tests for `sessionStatusSchema` — the `/auth/session/status` payload
 * validator the authorize page runs over the device-flow status response.
 *
 * The status response carries the resolved `application` identity (a real
 * registered `Application`, surfaced as a `PublicApplication`). These tests pin
 * the contract:
 *   - a realistic status response with a full `application` object parses
 *     through with the application PRESERVED (never stripped);
 *   - `application: null` is accepted (no application could be resolved);
 *   - a status response with no `application` field at all is accepted;
 *   - an `application` with an invalid `type` enum collapses the parse to null.
 *
 * A field-shape mismatch here would collapse `safeParse` to null and route the
 * authorize page to its unresolved-application error path, so the schema must
 * mirror the API's real `/auth/session/status` shape exactly.
 */
import { describe, expect, test } from "bun:test"
import { sessionStatusSchema, safeParse } from "@/lib/schemas"

describe("sessionStatusSchema", () => {
    test("parses a status response with a full application object (application preserved)", () => {
        const payload = {
            status: "pending",
            authorized: false,
            sessionToken: "sess_abc123",
            application: {
                id: "app1",
                name: "Mention",
                description: "Social media for the fediverse",
                icon: "https://cdn.oxy.so/app/mention.png",
                websiteUrl: "https://mention.earth",
                type: "first_party",
                isOfficial: true,
                isInternal: false,
                scopes: ["user:read", "files:read"],
                developerName: "Oxy",
            },
            expiresAt: new Date().toISOString(),
            sessionId: "s1",
            publicKey: "0xabc",
            userId: "u1",
        }

        const parsed = safeParse(sessionStatusSchema, payload)
        expect(parsed).not.toBeNull()
        // The application object survives the parse intact — not stripped.
        expect(parsed?.application).not.toBeNull()
        expect(parsed?.application?.id).toBe("app1")
        expect(parsed?.application?.name).toBe("Mention")
        expect(parsed?.application?.type).toBe("first_party")
        expect(parsed?.application?.isOfficial).toBe(true)
        expect(parsed?.application?.scopes).toEqual(["user:read", "files:read"])
        expect(parsed?.application?.developerName).toBe("Oxy")
    })

    test("accepts application: null (no application could be resolved)", () => {
        const payload = {
            status: "pending",
            sessionToken: "sess_def456",
            application: null,
            expiresAt: new Date().toISOString(),
            sessionId: "s2",
        }

        const parsed = safeParse(sessionStatusSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.application).toBeNull()
    })

    test("accepts a status response with no application field at all", () => {
        const payload = {
            status: "expired",
            sessionId: "s3",
        }

        const parsed = safeParse(sessionStatusSchema, payload)
        expect(parsed).not.toBeNull()
        expect(parsed?.status).toBe("expired")
        expect(parsed?.application).toBeUndefined()
    })

    test("rejects an application with an invalid type enum value", () => {
        const payload = {
            status: "pending",
            application: {
                id: "app5",
                name: "Rogue",
                type: "not_a_real_type",
                isOfficial: false,
                isInternal: false,
                scopes: [],
            },
        }

        // A malformed application object collapses the whole parse to null,
        // which the authorize page treats as an unresolved request.
        expect(safeParse(sessionStatusSchema, payload)).toBeNull()
    })
})
