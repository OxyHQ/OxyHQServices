import React, { useEffect } from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import { BloomThemeProvider } from "@oxyhq/bloom/theme"
import { Toaster } from "@/components/ui/sonner"
import { FedCMLoginStatus } from "@/components/fedcm-login-status"
import { getBloomThemeCSS } from "@/lib/bloom-css"
import { LayoutProvider } from "@/lib/layout-context"
import { AuthLayout } from "@/src/pages/layout"
import { LoginPage } from "@/src/pages/login"
import { SignUpPage } from "@/src/pages/signup"
import { AuthorizePage } from "@/src/pages/authorize"
import { RecoverPage } from "@/src/pages/recover"
import { AuthCallbackPage } from "@/src/pages/auth-callback"
import { SocialCallbackPage } from "@/src/pages/social-callback"
import { SettingsLayout } from "@/src/pages/settings/layout"
import { ChangePasswordPage } from "@/src/pages/settings/password"
import { SessionsPage } from "@/src/pages/settings/sessions"
import { LinkedAccountsPage } from "@/src/pages/settings/linked-accounts"
import "@/app/globals.css"

function ExternalRedirect({ url }: { url: string }) {
    useEffect(() => {
        window.location.href = url
    }, [url])
    return null
}

// Inject bloom theme CSS vars before first paint (FOUC prevention)
const bloomCSS = getBloomThemeCSS()
const styleEl = document.createElement("style")
styleEl.textContent = bloomCSS
document.head.appendChild(styleEl)

function App() {
    return (
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

                        {/* Account settings routes */}
                        <Route element={<SettingsLayout />}>
                            <Route path="/settings" element={<Navigate to="/settings/password" replace />} />
                            <Route path="/settings/password" element={<ChangePasswordPage />} />
                            <Route path="/settings/sessions" element={<SessionsPage />} />
                            <Route path="/settings/linked-accounts" element={<LinkedAccountsPage />} />
                        </Route>

                        {/* Callback routes (no layout) */}
                        <Route path="/auth/callback" element={<AuthCallbackPage />} />
                        <Route path="/auth/social/callback" element={<SocialCallbackPage />} />

                        <Route path="/" element={<ExternalRedirect url="https://oxy.so" />} />
                        <Route path="*" element={<Navigate to="/login" replace />} />
                    </Routes>
                    <Toaster position="bottom-right" />
                    <FedCMLoginStatus />
                </BrowserRouter>
            </BloomThemeProvider>
        </LayoutProvider>
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
