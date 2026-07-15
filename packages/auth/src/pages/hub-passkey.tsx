import { useCallback, useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { OxyAuthChooser, useOxy } from "@oxyhq/services"
import type { CommonsApprovalInfo } from "@oxyhq/core"
import { Button } from "@oxyhq/bloom/button"
import { buildAuthUrl } from "@/lib/oxy-api-client"
import { AuthFormLayout, AuthFormHeader, LoadingSpinner } from "@/components/auth-form-layout"

/**
 * Cross-origin passkey hub (b2).
 *
 * A non-Oxy-origin app (mention.earth, homiio.com, …) can't run a WebAuthn
 * ceremony locally — a credential minted with `WEBAUTHN_RP_ID=oxy.so` can
 * only be asserted from `oxy.so`/a subdomain/loopback. Its `OxyAccountDialog`
 * instead opens THIS page as a popup (`AccountDialogController.
 * startPasskeyHubSignIn`), where the ceremony IS first-party, and relays the
 * result back.
 *
 * This page just mounts the SAME `OxyAuthChooser` every other Oxy surface
 * uses — bare, no Dialog chrome — so every sign-in/sign-up path (passkey,
 * Commons QR, switching an existing hub-local account) works here for free.
 * Once it completes (a bearer is planted on THIS origin), this page
 * authorizes the RP's pending device-flow session by its PUBLIC
 * `authorizeCode` (`POST /auth/session/authorize-code/:code`, bearer-authed)
 * — the SECRET `sessionToken` never travels here in any form, only the
 * public code the popup URL carries. The opener's own poll/`/auth-session`
 * socket subscription (unchanged, the same one the Commons QR flow drives)
 * then completes the hand-off and closes its own waiting state; this page
 * just confirms success and closes itself.
 */
export function HubPasskeyPage() {
    const [searchParams] = useSearchParams()
    const code = searchParams.get("code")
    const { oxyServices, accountDialogController } = useOxy()

    const [approval, setApproval] = useState<CommonsApprovalInfo | null>(null)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [authorizeError, setAuthorizeError] = useState<string | null>(null)
    const [done, setDone] = useState(false)
    const completingRef = useRef(false)

    const hasOpener = typeof window !== "undefined" && window.opener != null

    // Jump straight to the sign-in entry — on web this auto-starts "Sign in
    // with Oxy" (the QR + passkey link, since this origin IS oxy.so). Any
    // account already active on THIS device still shows above it and
    // completes in one tap (the chooser treats tapping the active row as an
    // immediate `onComplete`, no network call).
    useEffect(() => {
        accountDialogController?.setView("signin")
    }, [accountDialogController])

    useEffect(() => {
        if (!code) return
        let cancelled = false
        void oxyServices
            .getCommonsApprovalInfo(code)
            .then((info) => {
                if (!cancelled) setApproval(info)
            })
            .catch((error: unknown) => {
                if (!cancelled) {
                    setLoadError(
                        error instanceof Error ? error.message : "This sign-in request could not be found.",
                    )
                }
            })
        return () => {
            cancelled = true
        }
    }, [code, oxyServices])

    const handleComplete = useCallback(() => {
        if (!code || completingRef.current) return
        completingRef.current = true
        void (async () => {
            try {
                const accessToken = oxyServices.getAccessToken()
                if (!accessToken) {
                    throw new Error("Sign-in did not produce an access token.")
                }
                const response = await fetch(
                    buildAuthUrl(`/session/authorize-code/${encodeURIComponent(code)}`),
                    {
                        method: "POST",
                        headers: {
                            "content-type": "application/json",
                            Authorization: `Bearer ${accessToken}`,
                        },
                        body: "{}",
                    },
                )
                if (!response.ok) {
                    const payload = await response.json().catch(() => null)
                    const message =
                        typeof payload?.message === "string" ? payload.message : "Could not complete sign-in."
                    throw new Error(message)
                }
                setDone(true)
                window.setTimeout(() => window.close(), 800)
            } catch (error) {
                completingRef.current = false
                setAuthorizeError(error instanceof Error ? error.message : "Could not complete sign-in.")
            }
        })()
    }, [code, oxyServices])

    const handleCancel = useCallback(() => {
        if (code) {
            void oxyServices.denyCommonsSignIn(code).catch(() => undefined)
        }
        window.close()
    }, [code, oxyServices])

    if (!code || !hasOpener) {
        return (
            <AuthFormLayout>
                <AuthFormHeader
                    title="Can't open this here"
                    description="Open this page from the app that asked you to sign in."
                />
            </AuthFormLayout>
        )
    }

    if (loadError) {
        return (
            <AuthFormLayout>
                <AuthFormHeader title="Sign-in request expired" description={loadError} />
            </AuthFormLayout>
        )
    }

    if (!approval) {
        return (
            <AuthFormLayout>
                <LoadingSpinner />
            </AuthFormLayout>
        )
    }

    if (done) {
        return (
            <AuthFormLayout>
                <AuthFormHeader
                    title="You're signed in"
                    description="You can close this window — it'll close on its own in a moment."
                />
            </AuthFormLayout>
        )
    }

    return (
        <AuthFormLayout>
            <AuthFormHeader
                title={`Continue to ${approval.application.name}`}
                description={
                    approval.originVerified
                        ? undefined
                        : "We couldn't verify where this request came from — only continue if you started this yourself."
                }
            />
            {authorizeError && <p className="text-destructive text-sm">{authorizeError}</p>}
            <OxyAuthChooser onComplete={handleComplete} />
            <Button variant="ghost" onClick={handleCancel}>
                Cancel
            </Button>
        </AuthFormLayout>
    )
}
