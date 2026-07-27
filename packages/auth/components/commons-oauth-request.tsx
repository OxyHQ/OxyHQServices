/**
 * The ACTIVE REQUEST surface for the authorize page's Commons lane (issue #691,
 * Phase 5 shape).
 *
 * The user already performed their one action — pressing "Sign in with Oxy" in
 * the relying party. From here this surface only REPORTS: the route-appropriate
 * primary visual, the status line derived from the lane's real signals, and
 * nothing else at the same weight. Every alternative stays behind "Having
 * trouble?" until the request FAILS, at which point the alternatives are all
 * that is left and render plainly — the same progressive-disclosure contract
 * `@oxyhq/services`' own `SignInRequestView` uses.
 *
 * Copy is shared, not re-invented: the headline, the progress ladder, and the
 * disclosure trigger all resolve through the auth app's `t()` fallback into
 * `@oxyhq/core`'s `accountSwitcher.*` dictionary — the exact strings every other
 * Oxy sign-in surface renders, in all 11 locales.
 *
 * ANTI-PHISHING: the QR encodes `snapshot.qrPayload` and renders NOTHING derived
 * from it. The requesting application's identity comes from the server-resolved
 * `appName` the page already looked up via `GET /auth/oauth/client/:clientId`,
 * never from the payload. And the payload itself carries only the PUBLIC
 * `authorizeCode` — the secret finalize credential never reaches this component.
 */

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import QRCode from "react-native-qrcode-svg"
import { Button } from "@oxyhq/bloom/button"
import { AuthFormLayout, AuthFormHeader, LoadingSpinner } from "@/components/auth-form-layout"
import { useTranslation } from "@/lib/i18n/use-translation"
import type { TranslateFn } from "@/lib/i18n/types"
import { CommonsOAuthRequest } from "@/lib/commons-oauth-request"
import type {
    CommonsOAuthBinding,
    CommonsOAuthClient,
    CommonsOAuthFailure,
    CommonsOAuthOutcome,
    CommonsOAuthProgress,
    CommonsOAuthSnapshot,
} from "@/lib/commons-oauth-request"

/** High-contrast QR colors — intentionally fixed (NOT themed) for scan reliability. */
const QR_PLATE_BG = "#FFFFFF"
const QR_FOREGROUND = "#000000"
const QR_SIZE = 196

/** Status-line copy, one key per derived progress step. */
const PROGRESS_KEYS: Record<CommonsOAuthProgress, string> = {
    preparing: "accountSwitcher.progress.preparing",
    "awaiting-approval": "accountSwitcher.progress.scanWithCommons",
    "opened-in-commons": "accountSwitcher.progress.openedInCommons",
    "confirming-identity": "accountSwitcher.progress.confirming",
    "identity-confirmed": "accountSwitcher.progress.confirmed",
}

/** Failure copy, one key per terminal reason the lane can report. */
const FAILURE_KEYS: Record<CommonsOAuthFailure, string> = {
    start_failed: "authorize.commons.errors.startFailed",
    request_expired: "authorize.commons.errors.requestExpired",
    unreachable: "authorize.commons.errors.unreachable",
    finalize_failed: "authorize.commons.errors.finalizeFailed",
    redirect_mismatch: "authorize.commons.errors.redirectMismatch",
}

/**
 * Failures a fresh request cannot fix. A mismatched redirect binding would come
 * back identical on every attempt, so offering "Try again" would only loop the
 * user through the same dead end — the surface leaves cancelling as the way out.
 */
const UNRECOVERABLE_FAILURES: readonly CommonsOAuthFailure[] = ["redirect_mismatch"]

type CommonsOAuthRequestViewProps = {
    snapshot: CommonsOAuthSnapshot
    /** Server-resolved application name, or null when the page has none to show. */
    appName?: string | null
    t: TranslateFn
    /** Start a BRAND-NEW request. Never a retry of a spent one. */
    onRetry: () => void
    /** Withdraw the request and report the standard OAuth denial. */
    onCancel: () => void
    /** Hand the public deep link to the Commons app on this very device. */
    onOpenInCommons: (qrPayload: string) => void
    /** Fall back to signing in on this origin (passkey / security key). */
    onSignInHere: () => void
}

/** A subordinate, non-competing action. Never styled as a primary button. */
function SubtleLink({
    label,
    onClick,
    testId,
}: {
    label: string
    onClick: () => void
    testId: string
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
            {label}
        </button>
    )
}

function CommonsOAuthRequestView({
    snapshot,
    appName,
    t,
    onRetry,
    onCancel,
    onOpenInCommons,
    onSignInHere,
}: CommonsOAuthRequestViewProps) {
    // The disclosure's own open state. Not derived from the snapshot: revealing
    // the alternatives is the USER asking for them, and a failure reveals them
    // unconditionally below without touching this.
    const [troubleOpen, setTroubleOpen] = useState(false)

    const failed = snapshot.phase === "failed"
    const failure = snapshot.failure
    const qrPayload = snapshot.qrPayload
    const canRetry = failed && failure !== null && !UNRECOVERABLE_FAILURES.includes(failure)

    const alternatives = (
        <div className="flex flex-col items-start gap-2">
            {qrPayload && !failed && (
                <SubtleLink
                    label={t("authorize.commons.openOnThisDevice")}
                    onClick={() => onOpenInCommons(qrPayload)}
                    testId="commons-open-on-this-device"
                />
            )}
            <SubtleLink
                label={t("authorize.commons.signInHere")}
                onClick={onSignInHere}
                testId="commons-sign-in-here"
            />
        </div>
    )

    return (
        <AuthFormLayout>
            <AuthFormHeader
                title={
                    appName
                        ? t("authorize.title", { app: appName })
                        : t("authorize.requestTitle")
                }
                description={t("authorize.commons.description")}
            />

            <div className="flex flex-col items-center gap-4">
                {failed && failure ? (
                    <>
                        <p
                            className="rounded-radius-12 border border-destructive/50 bg-destructive/10 p-space-12 font-bodySmall text-bodySmall text-destructive"
                            data-testid="commons-failure"
                        >
                            {t(FAILURE_KEYS[failure])}
                        </p>
                        {canRetry && (
                            <Button size="lg" className="w-full" onClick={onRetry}>
                                {t("common.actions.tryAgain")}
                            </Button>
                        )}
                    </>
                ) : snapshot.phase === "waiting" && snapshot.route === "qr" && qrPayload ? (
                    <>
                        <p className="text-center font-medium">
                            {t("accountSwitcher.qrHeadline")}
                        </p>
                        <div
                            className="rounded-radius-12 p-4"
                            style={{ backgroundColor: QR_PLATE_BG }}
                            data-testid="commons-qr-plate"
                        >
                            <QRCode
                                value={qrPayload}
                                size={QR_SIZE}
                                backgroundColor={QR_PLATE_BG}
                                color={QR_FOREGROUND}
                            />
                        </div>
                    </>
                ) : (
                    <LoadingSpinner />
                )}

                {snapshot.progress && (
                    <p
                        className="text-sm text-muted-foreground"
                        aria-live="polite"
                        data-testid="commons-progress"
                    >
                        {t(PROGRESS_KEYS[snapshot.progress])}
                    </p>
                )}
            </div>

            <div className="flex flex-col items-start gap-3">
                {/* A failed request has no working primary route left, so the
                    alternatives ARE the content now and render without asking. */}
                {failed ? (
                    alternatives
                ) : (
                    <>
                        <SubtleLink
                            label={t("accountSwitcher.havingTrouble")}
                            onClick={() => setTroubleOpen((open) => !open)}
                            testId="commons-trouble-disclosure"
                        />
                        {troubleOpen && alternatives}
                    </>
                )}
                <SubtleLink
                    label={t("authorize.cancel")}
                    onClick={onCancel}
                    testId="commons-cancel"
                />
            </div>
        </AuthFormLayout>
    )
}

type CommonsOAuthLaneProps = {
    /** The OAuth binding built from the authorize URL's validated parameters. */
    binding: CommonsOAuthBinding
    /** The SDK client. `useOxy().oxyServices` satisfies this structurally. */
    client: CommonsOAuthClient
    /** Server-resolved application name, or null when the page has none to show. */
    appName?: string | null
    /**
     * The lane's ONE terminal outcome. The page delivers it through the SAME
     * `deliverOAuthResult` funnel the session-bearing path uses, so the popup
     * relay and the redirect fallback stay one decision.
     */
    onOutcome: (outcome: CommonsOAuthOutcome) => void
    /** Fall back to signing in on this origin (passkey / security key). */
    onSignInHere: () => void
}

/**
 * Owns the lane's lifecycle: exactly ONE {@link CommonsOAuthRequest} for the
 * component's lifetime, started on mount and abandoned on unmount.
 *
 * The controller is created once from the props it is given, so changing the
 * binding or the client means REMOUNTING this component — which is what the
 * authorize page does, since both are derived from URL parameters that cannot
 * change without a navigation.
 */
export function CommonsOAuthLane({
    binding,
    client,
    appName,
    onOutcome,
    onSignInHere,
}: CommonsOAuthLaneProps) {
    const { t } = useTranslation()

    // The outcome handler is invoked at most once, asynchronously, long after
    // construction — so the controller dispatches through a ref rather than
    // capturing whichever closure existed on the first render.
    const outcomeRef = useRef(onOutcome)
    useEffect(() => {
        outcomeRef.current = onOutcome
    }, [onOutcome])

    const [request] = useState(
        () =>
            new CommonsOAuthRequest({
                client,
                clientId: binding.clientId,
                oauth: binding.oauth,
                onOutcome: (outcome) => outcomeRef.current(outcome),
            }),
    )

    useEffect(() => {
        request.start()
        return () => request.dispose()
    }, [request])

    const snapshot = useSyncExternalStore(request.subscribe, request.getSnapshot, request.getSnapshot)

    return (
        <CommonsOAuthRequestView
            snapshot={snapshot}
            appName={appName}
            t={t}
            onRetry={request.start}
            onCancel={request.cancel}
            onOpenInCommons={(qrPayload) => {
                // The PUBLIC deep link only — it carries the `authorizeCode`, never
                // the secret finalize credential. An explicit user choice from the
                // disclosure, never an automatic route (a browser cannot verify
                // that a Commons app link resolves on this device).
                window.location.href = qrPayload
            }}
            onSignInHere={onSignInHere}
        />
    )
}
