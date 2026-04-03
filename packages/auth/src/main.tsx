import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { FedCMLoginStatus } from "@/components/fedcm-login-status";
import { getBloomThemeCSS } from "@/lib/bloom-css";
import { AuthLayout } from "@/src/pages/layout";
import { LoginPage } from "@/src/pages/login";
import { SignUpPage } from "@/src/pages/signup";
import { AuthorizePage } from "@/src/pages/authorize";
import { RecoverPage } from "@/src/pages/recover";
import { AuthCallbackPage } from "@/src/pages/auth-callback";
import { SocialCallbackPage } from "@/src/pages/social-callback";
import "@/app/globals.css";

function ExternalRedirect({ url }: { url: string }) {
  window.location.href = url;
  return null;
}

// Inject bloom theme CSS
const bloomCSS = getBloomThemeCSS();
const styleEl = document.createElement("style");
styleEl.textContent = bloomCSS;
document.head.appendChild(styleEl);

function App() {
  return (
    <BrowserRouter>
      <Routes>
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

        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/social/callback" element={<SocialCallbackPage />} />

        <Route path="/" element={<ExternalRedirect url="https://oxy.so" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
      <Toaster position="bottom-right" />
      <FedCMLoginStatus />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
