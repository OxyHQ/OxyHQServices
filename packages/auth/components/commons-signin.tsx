import { ArrowLeft } from "lucide-react"
import type { OxyServices } from "@oxyhq/core"
import { Button } from "@oxyhq/bloom/button"
import { FieldGroup } from "@/components/ui/field"
import { AuthFormHeader } from "@/components/auth-form-layout"
import { useCommonsSignIn } from "@/lib/use-commons-signin"

type CommonsSignInProps = {
    className?: string
    /** OxyServices client (shares the IdP's configured API base URL). */
    oxyServices: OxyServices
    /** The IdP's own registered OAuth client id. */
    clientId: string
    /**
     * Called when the user approves the request in their Oxy app. Hand the
     * device-flow `sessionId` to the IdP's existing `completeLogin` path so the
     * QR sign-in finishes exactly like a password sign-in (FedCM cookie / OAuth
     * redirect / security-alert).
     */
    onAuthorized: (sessionId: string) => void
    /** Return to the username step. */
    onBack: () => void
}

/**
 * "Sign in with Oxy" — the cross-device QR option on the IdP login screen.
 *
 * The web page never touches a private key: it shows a QR, the user's Oxy app
 * scans and approves it on their phone, and this screen polls + completes the
 * login. Approval (consent) happens entirely in the Oxy app, so the IdP's
 * `/authorize` consent page is not involved here.
 */
export function CommonsSignIn({
    className,
    oxyServices,
    clientId,
    onAuthorized,
    onBack,
}: CommonsSignInProps) {
    const { phase, qrImageDataUrl, error, start } = useCommonsSignIn({
        oxyServices,
        clientId,
        onAuthorized,
        autoStart: true,
    })

    return (
        <div className={className}>
            <FieldGroup>
                <AuthFormHeader
                    title="Sign in with Oxy"
                    description="Scan this code with your Oxy app to approve."
                />

                <div className="flex flex-col items-center gap-4 text-center">
                    {phase === "waiting" && qrImageDataUrl ? (
                        <>
                            <div className="rounded-2xl border bg-white p-4">
                                <img
                                    src={qrImageDataUrl}
                                    alt="Sign in with Oxy QR code"
                                    width={232}
                                    height={232}
                                    className="block size-[232px]"
                                />
                            </div>
                            <p className="text-base text-muted-foreground max-w-[18rem]">
                                Open the Oxy app on your phone and scan this code to
                                approve the sign-in.
                            </p>
                        </>
                    ) : null}

                    {phase === "starting" ? (
                        <div className="flex flex-col items-center gap-4 min-h-[260px] justify-center">
                            <div className="auth-loading-morph" />
                            <p className="text-base text-muted-foreground">
                                Preparing your code…
                            </p>
                        </div>
                    ) : null}

                    {phase === "authorized" ? (
                        <div className="flex flex-col items-center gap-4 min-h-[260px] justify-center">
                            <div className="auth-loading-morph" />
                            <p className="text-base text-muted-foreground">
                                Approved — signing you in…
                            </p>
                        </div>
                    ) : null}

                    {phase === "denied" ? (
                        <div className="flex flex-col items-center gap-4 min-h-[260px] justify-center">
                            <p className="text-base text-muted-foreground max-w-[18rem]">
                                The sign-in was denied in your Oxy app.
                            </p>
                            <Button size="lg" onClick={start}>
                                Show a new code
                            </Button>
                        </div>
                    ) : null}

                    {phase === "expired" ? (
                        <div className="flex flex-col items-center gap-4 min-h-[260px] justify-center">
                            <p className="text-base text-muted-foreground max-w-[18rem]">
                                This code expired. Show a new one to try again.
                            </p>
                            <Button size="lg" onClick={start}>
                                Show a new code
                            </Button>
                        </div>
                    ) : null}

                    {phase === "error" ? (
                        <div className="flex flex-col items-center gap-4 min-h-[260px] justify-center">
                            <p className="text-base text-destructive max-w-[18rem]">
                                {error ?? "Something went wrong. Please try again."}
                            </p>
                            <Button size="lg" onClick={start}>
                                Try again
                            </Button>
                        </div>
                    ) : null}
                </div>

                <Button
                    type="button"
                    variant="outline"
                    size="lg"
                    onClick={onBack}
                    className="w-full"
                >
                    <ArrowLeft className="size-4" />
                    Back
                </Button>
            </FieldGroup>
        </div>
    )
}
