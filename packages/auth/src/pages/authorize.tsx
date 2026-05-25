import { useEffect, useState } from "react";
import { useSearchParams, Link, useNavigate, Navigate } from "react-router-dom";
import { Check, Shield } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FieldDescription } from "@/components/ui/field";
import { Avatar } from "@oxyhq/bloom/avatar";
import {
  AuthFormLayout,
  AuthFormHeader,
  LoadingSpinner,
  isPopupWindow,
  tryClosePopup,
} from "@/components/auth-form-layout";
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
  // OAuth2 authorization code flow parameters. When `client_id` is present
  // we exchange the user's consent for a single-use code (not a token) and
  // redirect with `?code=<code>&state=<state>` — never `?access_token=...`.
  // PKCE (code_challenge + S256) is REQUIRED for public clients. Servers MUST
  // strip these from logs / referrers since they are short-lived bearer-like
  // credentials.
  const clientId = searchParams.get("client_id");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const scope = searchParams.get("scope");
  const statusParam = searchParams.get("status");
  const urlError = searchParams.get("error");

  const [data, setData] = useState<AuthorizeData>({
    user: null,
    sessionId: null,
    sessionStatus: statusParam,
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
          const meResponse = await fetch(buildApiUrl("/users/me"), {
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
          // No existing session — handled by the page-level redirect below.
        }

        // If we have an auth session token, check its status
        if (!statusParam && token) {
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
          sessionStatus: statusParam,
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
  }, [token, redirectUri, state, statusParam, urlError]);

  // Auto-close popup when authorization is complete
  useEffect(() => {
    const effectiveStatus = data.sessionStatus;
    if (
      (effectiveStatus === "approved" || effectiveStatus === "denied") &&
      isPopupWindow()
    ) {
      // Small delay so any pending redirects / postMessages can fire
      const timer = setTimeout(() => tryClosePopup(), 800);
      return () => clearTimeout(timer);
    }
  }, [data.sessionStatus]);

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

    // Approve. Two distinct redirect paths:
    //   - OAuth2 authorization code flow (when `client_id` is in the URL):
    //     mint a short-lived code and redirect with `?code=<code>&state=...`.
    //   - Legacy cross-app QR-code handoff (no `client_id`): authorize the
    //     pending AuthSession via the Bearer-auth endpoint and notify the
    //     polling client via socket.io. No tokens ever appear in the URL.
    try {
      const sessionId = data.sessionId;
      const storedToken = sessionStorage.getItem("oxy_access_token");

      if (!storedToken) {
        setData((prev) => ({
          ...prev,
          error: "Sign in required to authorize this request.",
        }));
        setSubmitting(false);
        return;
      }

      // ---- OAuth2 authorization code flow ----
      if (clientId && safeRedirect) {
        const body: Record<string, string> = {
          clientId,
          redirectUri: safeRedirect,
        };
        if (codeChallenge) {
          body.codeChallenge = codeChallenge;
          body.codeChallengeMethod = codeChallengeMethod || "S256";
        }
        if (scope) body.scope = scope;
        if (state) body.state = state;

        const codeResponse = await fetch(buildApiUrl("/auth/oauth/authorize"), {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${storedToken}`,
          },
          body: JSON.stringify(body),
        });

        if (codeResponse.status === 401) {
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

        if (!codeResponse.ok) {
          const errPayload = await codeResponse.json().catch(() => ({}));
          const message =
            typeof errPayload?.message === "string"
              ? errPayload.message
              : "Authorization failed";
          setData((prev) => ({ ...prev, error: message }));
          setSubmitting(false);
          return;
        }

        const codeResult = await codeResponse.json();
        const codeData = codeResult.data || codeResult;
        const url = new URL(safeRedirect);
        url.searchParams.set("code", codeData.code);
        if (state) url.searchParams.set("state", state);
        window.location.href = url.toString();
        return;
      }

      // ---- Legacy cross-app handoff (token + AuthSession) ----
      if (!token) {
        setData((prev) => ({
          ...prev,
          error: "Missing authorization request token.",
        }));
        setSubmitting(false);
        return;
      }

      if (!sessionId) {
        setData((prev) => ({
          ...prev,
          error: "No session found. Please sign in again.",
        }));
        setSubmitting(false);
        return;
      }

      const authorizeResponse = await fetch(
        buildAuthUrl(`/session/authorize/${token}`),
        {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            Authorization: `Bearer ${storedToken}`,
          },
          body: JSON.stringify({}),
        }
      );

      if (authorizeResponse.status === 401) {
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

      if (!authorizeResponse.ok) {
        const errPayload = await authorizeResponse.json().catch(() => ({}));
        const message =
          typeof errPayload?.message === "string"
            ? errPayload.message
            : "Authorization failed";
        setData((prev) => ({ ...prev, error: message }));
        setSubmitting(false);
        return;
      }

      // The cross-app handoff completes server-side via socket emission to
      // the polling client; no tokens are returned to the auth UI and none
      // appear in the URL. We just confirm completion to the user.
      navigate(
        buildRelativeUrl("/authorize", {
          token: token || undefined,
          status: "approved",
        })
      );
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : "Authorization failed";
      setData((prev) => ({ ...prev, error: msg }));
      setSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!token && !clientId) {
    return (
      <AuthFormLayout>
        <AuthFormHeader
          title="No authorization request"
          description="Open the app you want to sign in to and try again. The authorization request starts there."
        />
        <Button asChild size="lg">
          <Link to="/login">Go to sign in</Link>
        </Button>
      </AuthFormLayout>
    );
  }

  if (!data.sessionId && !data.user) {
    // No session - redirect to login
    return (
      <Navigate
        to={buildRelativeUrl("/login", {
          token: token || undefined,
          redirect_uri: redirectUri || undefined,
          state: state || undefined,
        })}
        replace
      />
    );
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
    <AuthFormLayout>
      {/* Status messages for completed flows */}
      {effectiveStatus === "approved" ||
      effectiveStatus === "denied" ? (
        <>
          <AuthFormHeader
            title={effectiveStatus === "approved"
              ? "Authorization complete"
              : "Authorization denied"}
            description={
              isPopupWindow()
                ? "This window will close automatically."
                : effectiveStatus === "approved"
                  ? "You can close this window."
                  : "The request was denied. You can close this window."
            }
          />
        </>
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
          <AuthFormHeader
            title={`Sign in to ${appName}`}
            description={`${appName} wants to access your Oxy account`}
          />

          {/* Error state */}
          {pageError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {pageError}
            </div>
          )}

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
                <FieldDescription className="text-xs">
                  Request expires at {expiresAt}.
                </FieldDescription>
              ) : null}

              {/* Action buttons — side by side pills, stack on tiny screens */}
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  variant="outline"
                  size="lg"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => handleDecision("deny")}
                >
                  Deny
                </Button>
                <Button
                  size="lg"
                  className="flex-1"
                  disabled={submitting}
                  onClick={() => handleDecision("approve")}
                >
                  {submitting ? "Authorizing..." : "Allow"}
                </Button>
              </div>
            </>
          ) : null}
        </>
      )}
    </AuthFormLayout>
  );
}
