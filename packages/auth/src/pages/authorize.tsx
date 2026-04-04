import { useEffect, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { Check, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@oxyhq/bloom/avatar";
import { ToastMessage } from "@/components/toast-message";
import {
  Empty,
  EmptyActions,
  EmptyDescription,
  EmptyTitle,
} from "@/components/ui/empty";
import { Logo } from "@/components/logo";
import {
  getAvatarUrl,
  buildRelativeUrl,
  buildAuthUrl,
  buildApiUrl,
} from "@/lib/oxy-api-client";

type UserInfo = {
  id: string;
  username?: string;
  email?: string;
  avatar?: string;
  displayName?: string;
  name?: {
    first?: string;
    last?: string;
  };
};

type AuthorizeData = {
  user: UserInfo | null;
  sessionId: string | null;
  sessionStatus: string | null;
  appName: string | null;
  expiresAt: string | null;
  error: string | null;
  redirected: boolean;
};

function getDisplayName(user: UserInfo): string {
  if (user.name?.first && user.name?.last) {
    return `${user.name.first} ${user.name.last}`;
  }
  return user.username || user.email || "User";
}

// Native app schemes that are allowed as redirect targets.
// These correspond to registered Oxy client applications (e.g. Astro browser).
const ALLOWED_NATIVE_SCHEMES = ["astro:"];

function safeRedirectUrl(value?: string | null): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    // Allow standard web protocols
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      // Block raw IP addresses for web redirects
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(parsed.hostname))
        return null;
      return parsed.toString();
    }
    // Allow registered native app schemes (no IP check needed)
    if (ALLOWED_NATIVE_SCHEMES.includes(parsed.protocol)) {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthorizePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const status = searchParams.get("status");
  const urlError = searchParams.get("error");

  const [data, setData] = useState<AuthorizeData>({
    user: null,
    sessionId: null,
    sessionStatus: status,
    appName: null,
    expiresAt: null,
    error: urlError,
    redirected: false,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        // Check for stored credentials from login
        const storedSessionId = sessionStorage.getItem("oxy_session_id");
        const storedToken = sessionStorage.getItem("oxy_access_token");

        let sessionId: string | null = storedSessionId;
        let user: UserInfo | null = null;

        // Try to get user info using stored token or cookies
        const authHeaders: Record<string, string> = {};
        if (storedToken) authHeaders["Authorization"] = `Bearer ${storedToken}`;

        try {
          const meResponse = await fetch(buildAuthUrl("/me"), {
            credentials: "include",
            headers: authHeaders,
          });
          if (meResponse.ok) {
            const meData = await meResponse.json();
            if (meData.user) {
              user = meData.user;
              if (meData.sessionId) sessionId = meData.sessionId;
            }
          }
        } catch {
          // No existing session
        }

        // If we have an auth session token, check its status
        if (!status && token) {
          try {
            const statusResponse = await fetch(
              buildAuthUrl(`/session/status/${token}`),
              { credentials: "include" }
            );
            if (!statusResponse.ok) {
              setData((prev) => ({
                ...prev,
                sessionId,
                user,
                error: "Unable to load authorization request.",
              }));
              return;
            }
            const statusResult = await statusResponse.json();
            // The Oxy API wraps in {data: ...}
            const sessionInfo = statusResult.data || statusResult;

            const safeRedirect = safeRedirectUrl(redirectUri);

            // If already authorized and has a redirect, build redirect URL with tokens
            if (
              sessionInfo.status === "authorized" &&
              sessionInfo.sessionId &&
              safeRedirect
            ) {
              const tokenResponse = await fetch(
                buildApiUrl(`/session/token/${sessionInfo.sessionId}`),
                { credentials: "include", headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {} }
              );
              if (tokenResponse.ok) {
                const tokenData = await tokenResponse.json();
                const redirectTarget = new URL(safeRedirect);
                redirectTarget.searchParams.set(
                  "access_token",
                  tokenData.accessToken
                );
                redirectTarget.searchParams.set(
                  "session_id",
                  sessionInfo.sessionId
                );
                redirectTarget.searchParams.set(
                  "expires_at",
                  tokenData.expiresAt
                );
                if (state) redirectTarget.searchParams.set("state", state);
                window.location.href = redirectTarget.toString();
                return;
              }
            }

            if (sessionInfo.status !== "pending") {
              const err =
                sessionInfo.status === "expired"
                  ? "This authorization request has expired."
                  : sessionInfo.status === "cancelled"
                    ? "Authorization was cancelled."
                    : "This authorization request is no longer active.";
              setData({
                sessionId,
                user,
                sessionStatus: sessionInfo.status,
                appName: sessionInfo.appId,
                expiresAt: null,
                error: err,
                redirected: false,
              });
              return;
            }

            // If we don't have user info yet but have a sessionId from the status
            if (!user && sessionInfo.sessionId) {
              try {
                const userResponse = await fetch(
                  buildApiUrl(`/session/user/${sessionInfo.sessionId}`),
                  { credentials: "include" }
                );
                if (userResponse.ok) {
                  const userData = await userResponse.json();
                  user = userData;
                  sessionId = sessionInfo.sessionId;
                }
              } catch {
                // Could not load user info
              }
            }

            setData({
              sessionId: sessionId || sessionInfo.sessionId,
              user,
              sessionStatus: sessionInfo.status,
              appName: sessionInfo.appId,
              expiresAt: sessionInfo.expiresAt,
              error: null,
              redirected: false,
            });
            return;
          } catch (err) {
            setData({
              sessionId,
              user,
              sessionStatus: null,
              appName: null,
              expiresAt: null,
              error:
                err instanceof Error
                  ? err.message
                  : "Unable to load request.",
              redirected: false,
            });
            return;
          }
        }

        setData({
          sessionId,
          user,
          sessionStatus: status,
          appName: null,
          expiresAt: null,
          error: urlError,
          redirected: false,
        });
      } catch {
        setData((prev) => ({ ...prev, error: "Unable to load request." }));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [token, redirectUri, state, status, urlError]);

  async function handleDecision(decision: "approve" | "deny") {
    if (!token) return;
    setSubmitting(true);

    const safeRedirect = safeRedirectUrl(redirectUri);

    if (decision === "deny") {
      // Cancel the auth session
      try {
        await fetch(buildAuthUrl(`/session/cancel/${token}`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
      } catch {
        // Ignore cancellation errors
      }
      if (safeRedirect) {
        const url = new URL(safeRedirect);
        url.searchParams.set("error", "access_denied");
        if (state) url.searchParams.set("state", state);
        window.location.href = url.toString();
      } else {
        navigate(
          buildRelativeUrl("/authorize", {
            token: token || undefined,
            status: "denied",
          })
        );
      }
      setSubmitting(false);
      return;
    }

    // Approve
    try {
      const sessionId = data.sessionId;
      if (!sessionId) {
        setData((prev) => ({
          ...prev,
          error: "No session found. Please sign in again.",
        }));
        setSubmitting(false);
        return;
      }

      // Authorize the auth session
      const storedToken = sessionStorage.getItem("oxy_access_token");
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-session-id": sessionId,
      };
      if (storedToken) headers["Authorization"] = `Bearer ${storedToken}`;

      const authorizeResponse = await fetch(
        buildAuthUrl(`/session/authorize/${token}`),
        {
          method: "POST",
          headers,
          credentials: "include",
          body: JSON.stringify({}),
        }
      );

      if (!authorizeResponse.ok) {
        const errPayload = await authorizeResponse.json().catch(() => ({}));
        const message =
          typeof errPayload?.message === "string"
            ? errPayload.message
            : "Authorization failed";
        const isExpired = message.toLowerCase().includes("expired") ||
          message.toLowerCase().includes("invalid session");
        if (isExpired) {
          navigate(
            buildRelativeUrl("/login", {
              token: token || undefined,
              redirect_uri: redirectUri || undefined,
              state: state || undefined,
              error: "Session expired. Please sign in again.",
            })
          );
          return;
        }
        setData((prev) => ({ ...prev, error: message }));
        setSubmitting(false);
        return;
      }

      const authorizeResult = await authorizeResponse.json();
      const authorizeData = authorizeResult.data || authorizeResult;
      const sessionIdForApp = authorizeData.sessionId || sessionId;

      if (safeRedirect) {
        // Get access token for the redirect
        const tokenResponse = await fetch(
          buildApiUrl(`/session/token/${sessionIdForApp}`),
          { credentials: "include", headers: storedToken ? { Authorization: `Bearer ${storedToken}` } : {} }
        );
        if (tokenResponse.ok) {
          const tokenData = await tokenResponse.json();
          const url = new URL(safeRedirect);
          url.searchParams.set("access_token", tokenData.accessToken);
          url.searchParams.set("session_id", sessionIdForApp);
          url.searchParams.set("expires_at", tokenData.expiresAt);
          if (state) url.searchParams.set("state", state);
          window.location.href = url.toString();
        } else {
          setData((prev) => ({
            ...prev,
            error: "Failed to retrieve access token.",
          }));
          setSubmitting(false);
        }
      } else {
        navigate(
          buildRelativeUrl("/authorize", {
            token: token || undefined,
            status: "approved",
          })
        );
      }
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Authorization failed";
      setData((prev) => ({ ...prev, error: msg }));
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-6 items-center justify-center min-h-[300px]">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!token) {
    return (
      <div className="flex flex-col gap-6">
        <Empty>
          <EmptyTitle>No authorization request</EmptyTitle>
          <EmptyDescription>
            Open the app you want to sign in to and try again. The authorization
            request starts there.
          </EmptyDescription>
          <EmptyActions>
            <Button asChild>
              <Link to="/login">Go to sign in</Link>
            </Button>
          </EmptyActions>
        </Empty>
      </div>
    );
  }

  if (!data.sessionId) {
    // No session - redirect to login
    window.location.href = buildRelativeUrl("/login", {
      token: token || undefined,
      redirect_uri: redirectUri || undefined,
      state: state || undefined,
    });
    return null;
  }

  const effectiveStatus = data.sessionStatus;
  const pageError = data.error;
  const appName = data.appName || "This app";
  const expiresAt = data.expiresAt;
  const currentUser = data.user;
  const displayName = currentUser ? getDisplayName(currentUser) : null;
  const userEmail = currentUser?.email;
  const showActions =
    !pageError && (!effectiveStatus || effectiveStatus === "pending");

  const loginUrl = buildRelativeUrl("/login", {
    token: token || undefined,
    redirect_uri: redirectUri || undefined,
    state: state || undefined,
  });

  return (
    <div className="flex flex-col gap-6 w-full max-w-md mx-auto">
      {/* Logo */}
      <div className="flex justify-center">
        <Link to="/login" className="flex items-center gap-2">
          <Logo />
          <span className="sr-only">Oxy</span>
        </Link>
      </div>

      <Card>
        <CardContent className="pt-6 pb-6 px-6 flex flex-col gap-5">
          {/* Status messages for completed flows */}
          {effectiveStatus === "approved" ||
          effectiveStatus === "denied" ? (
            <div className="text-center space-y-2">
              <h1 className="text-xl font-semibold">
                {effectiveStatus === "approved"
                  ? "Authorization complete"
                  : "Authorization denied"}
              </h1>
              <p className="text-sm text-muted-foreground">
                {effectiveStatus === "approved"
                  ? "You can close this window."
                  : "The request was denied. You can close this window."}
              </p>
            </div>
          ) : (
            <>
              {/* User identity badge */}
              {currentUser ? (
                <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                  <Avatar
                    source={
                      currentUser.avatar
                        ? getAvatarUrl(currentUser.avatar)
                        : undefined
                    }
                    size={40}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">
                      {displayName}
                    </div>
                    {userEmail && (
                      <div className="text-xs text-muted-foreground truncate">
                        {userEmail}
                      </div>
                    )}
                  </div>
                  <Link
                    to={loginUrl}
                    className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 shrink-0"
                  >
                    Not you?
                  </Link>
                </div>
              ) : null}

              {/* Heading */}
              <div className="text-center space-y-1">
                <h1 className="text-xl font-semibold">
                  Sign in to{" "}
                  <span className="text-primary">{appName}</span>
                </h1>
                <p className="text-sm text-muted-foreground">
                  {appName} wants to access your Oxy account
                </p>
              </div>

              {/* Error state */}
              {pageError ? (
                <ToastMessage
                  title="Authorization error"
                  description={pageError}
                  variant="error"
                />
              ) : null}

              {/* Permissions section */}
              {showActions ? (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Shield className="size-4" />
                      <span>This will allow {appName} to:</span>
                    </div>
                    <ul className="space-y-2 pl-1">
                      <li className="flex items-start gap-2.5 text-sm">
                        <Check className="size-4 text-primary shrink-0 mt-0.5" />
                        <span>See your basic profile information</span>
                      </li>
                      <li className="flex items-start gap-2.5 text-sm">
                        <Check className="size-4 text-primary shrink-0 mt-0.5" />
                        <span>Access your account on your behalf</span>
                      </li>
                    </ul>
                  </div>

                  {expiresAt ? (
                    <FieldDescription className="text-center text-xs">
                      Request expires at {expiresAt}.
                    </FieldDescription>
                  ) : null}

                  {/* Action buttons */}
                  <div className="flex flex-col gap-2">
                    <Button
                      className="w-full"
                      disabled={submitting}
                      onClick={() => handleDecision("approve")}
                    >
                      {submitting ? "Authorizing..." : "Allow"}
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={submitting}
                      onClick={() => handleDecision("deny")}
                    >
                      Deny
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {/* Footer */}
      <p className="px-6 text-center text-xs text-muted-foreground">
        By continuing, you agree to Oxy&apos;s{" "}
        <a
          href="https://oxy.so/company/transparency/policies/terms-of-service"
          className="underline underline-offset-4 hover:text-primary"
        >
          Terms of Service
        </a>{" "}
        and{" "}
        <a
          href="https://oxy.so/company/transparency/policies/privacy"
          className="underline underline-offset-4 hover:text-primary"
        >
          Privacy Policy
        </a>
        .
      </p>
    </div>
  );
}
