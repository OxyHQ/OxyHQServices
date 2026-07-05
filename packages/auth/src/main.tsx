import React, { useEffect } from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { BloomThemeProvider } from "@oxyhq/bloom/theme"
import { Toaster } from "@/components/ui/sonner"
import { getBloomThemeCSS, setBasePreset } from "@/lib/bloom-css"
import { LayoutProvider } from "@/lib/layout-context"
import { LocaleProvider } from "@/lib/i18n/locale-context"
import { AuthLayout } from "@/src/pages/layout"
import { LoginPage } from "@/src/pages/login"
import { SignUpPage } from "@/src/pages/signup"
import { AuthorizePage } from "@/src/pages/authorize"
import { RecoverPage } from "@/src/pages/recover"
import { SocialCallbackPage } from "@/src/pages/social-callback"
import "@/app/globals.css"

function ExternalRedirect({ url }: { url: string }) {
    useEffect(() => {
        window.location.replace(url)
    }, [url])
    return null
}

// Inject bloom theme CSS vars before first paint (FOUC prevention). The
// synchronous string injection keeps the very first render themed; the
// `setBasePreset` call right after captures the same preset so hover overlays
// in the chooser know how to restore it.
const bloomCSS = getBloomThemeCSS()
const styleEl = document.createElement("style")
styleEl.textContent = bloomCSS
document.head.appendChild(styleEl)
setBasePreset("oxy")

function App() {
    return (
        <LocaleProvider>
            <LayoutProvider>
                <BloomThemeProvider mode="system" colorPreset="oxy">
                    <BrowserRouter>
                        <Routes>
                            {/* Auth flow routes */}
                            <Route element={<AuthLayout />}>
                                <Route path="/login" element={<LoginPage />} />
                                <Route path="/signup" element={<SignUpPage />} />
                                <Route path="/authorize" element={<AuthorizePage />} />
                                <Route path="/recover" element={<RecoverPage />} />
                                <Route path="/auth/login" element={<LoginPage />} />
                                <Route path="/auth/signup" element={<SignUpPage />} />
                                <Route path="/auth/authorize" element={<AuthorizePage />} />
                                <Route path="/auth/recover" element={<RecoverPage />} />
                            </Route>

                            {/* Account management lives on accounts.oxy.so — the IdP no longer
                                owns account settings. Permanent redirects to the sole owner. */}
                            <Route path="/settings" element={<ExternalRedirect url="https://accounts.oxy.so/security" />} />
                            <Route path="/settings/password" element={<ExternalRedirect url="https://accounts.oxy.so/security" />} />
                            <Route path="/settings/linked-accounts" element={<ExternalRedirect url="https://accounts.oxy.so/security" />} />
                            <Route path="/settings/sessions" element={<ExternalRedirect url="https://accounts.oxy.so/sessions" />} />

                            {/* Callback routes (no layout) */}
                            <Route path="/auth/social/callback" element={<SocialCallbackPage />} />

                            <Route path="/" element={<ExternalRedirect url="https://oxy.so" />} />
                            <Route path="*" element={<Navigate to="/login" replace />} />
                        </Routes>
                        <Toaster position="bottom-right" />
                    </BrowserRouter>
                </BloomThemeProvider>
            </LayoutProvider>
        </LocaleProvider>
    )
}

const rootEl = document.getElementById("root")
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    )
}
