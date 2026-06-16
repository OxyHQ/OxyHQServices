import { useEffect, useState } from "react";
import { useSearchParams, Link, useNavigate, Navigate } from "react-router-dom";
import { getAccountDisplayName } from "@oxyhq/core";
import type { PublicApplication } from "@oxyhq/core";

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
import { AccountChooser } from "@/components/account-chooser";
import { AppIdentityCard } from "@/components/app-identity-card";
import { useDeviceAccounts } from "@/lib/use-device-accounts";
import { sessionStatusSchema, safeParse } from "@/lib/schemas";
import type { DeviceAccount } from "@/lib/types";
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
  application: PublicApplication | null;
  expiresAt: string | null;
  error: string | null;
  redirected: boolean;
};

/** Error shown when the requesting application cannot be resolved. */
const UNRESOLVED_APP_ERROR = "Unable to identify the requesting application.";

/**
 * Resolve a `client_id` to its public application identity via the unauthenticated
 * `GET /auth/oauth/client/:clientId` endpoint. Returns null when the client is
 * unknown (404) or the response is malformed — the caller renders the explicit
 * unresolved-application error rather than any generic fallback.
 */
async function resolvePublicApplication(
  clientId: string
): Promise<PublicApplication | null> {
  try {
    const response = await fetch(
      buildApiUrl(`/auth/oauth/client/${encodeURIComponent(clientId)}`),
      { credentials: "include" }
    );
    if (!response.ok) return null;
    const result = await response.json();
    const application = (result?.data ?? result)?.application;
    if (application && typeof application.id === "string") {
      return application as PublicApplication;
    }
    return null;
  } catch {
    return null;
  }
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
    application: null,
    expiresAt: null,
    error: urlError,
    redirected: false,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Google-style account chooser shown as an additive front screen before the
  // consent UI. Detect accounts signed in on this device; selecting the active
  // account mints+plants its token and reveals consent, while any other account
  // re-routes to /login (the current cookie cannot mint another account's
  // token). Dismissed once a choice is made.
  const {
    accounts: deviceAccounts,
    currentSessionId: chooserSessionId,
  } = useDeviceAccounts();
  const [chooserDismissed, setChooserDismissed] = useState(false);
  // The sessionId currently being switched-to via the cookie-mint path. Shown
  // as a per-row busy state in `<AccountChooser>` and disables sibling rows so
  // the user can't fire a second mint while one is in flight. Cleared on
  // success (consent reveal) or on failure (re-auth fallback).
  const [chooserPendingSessionId, setChooserPendingSessionId] = useState<
    string | null
  >(null);

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

        // OAuth code flow: resolve the requesting application from its
        // `client_id`. This runs whenever a client_id is present (with or
        // without a device-flow token) and is the authoritative identity source
        // for the OAuth path.
        const oauthApplication = clientId
          ? await resolvePublicApplication(clientId)
          : null;

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
            // The Oxy API wraps the payload in `{ data: ... }`. Validate the
            // inner object against the real `/auth/session/status` contract. A
            // malformed body parses to null; we then fall through to the
            // unresolved-application path below (no crash, no invented app name).
            const sessionInfo = safeParse(
              sessionStatusSchema,
              statusResult.data ?? statusResult
            );

            // Device flow: the validated status response carries the resolved
            // public application directly. OAuth code flow: prefer the
            // client-resolved application — the OAuth path always takes
            // precedence. An unresolved request surfaces as an error, never a
            // generic app name.
            const deviceApplication: PublicApplication | null =
              sessionInfo?.application ?? null;
            const application = oauthApplication ?? deviceApplication;

            // A null parse (malformed status) is treated as an unresolved /
            // failed request: surface the resolved app if the OAuth path found
            // one, otherwise the explicit unresolved-application error.
            if (!sessionInfo) {
              setData({
                sessionId,
                user,
                sessionStatus: null,
                application,
                expiresAt: null,
                error: application ? null : UNRESOLVED_APP_ERROR,
                redirected: false,
              });
              return;
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
                application,
                expiresAt: null,
                error: err,
                redirected: false,
              });
              return;
            }

            setData({
              sessionId: sessionId || sessionInfo.sessionId || null,
              user,
              sessionStatus: sessionInfo.status,
              application,
              expiresAt: sessionInfo.expiresAt ?? null,
              error: application ? null : UNRESOLVED_APP_ERROR,
              redirected: false,
            });
            return;
          } catch (err) {
            setData({
              sessionId,
              user,
              sessionStatus: null,
              application: oauthApplication,
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

        // OAuth code flow without a device-flow token (or with status already
        // resolved via the URL). The application MUST resolve from client_id.
        const resolvedError = urlError
          ? urlError
          : clientId && !oauthApplication
            ? UNRESOLVED_APP_ERROR
            : null;

        setData({
          sessionId,
          user,
          sessionStatus: statusParam,
          application: oauthApplication,
          expiresAt: null,
          error: resolvedError,
          redirected: false,
        });
      } catch {
        setData((prev) => ({ ...prev, error: "Unable to load request." }));
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [token, redirectUri, state, statusParam, urlError, clientId]);

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

  // Re-routes to /login carrying the full authorization request context (plus
  // OAuth2 PKCE params) so the user lands back on this consent screen after
  // re-authenticating. `hint` pre-fills the username for a known account.
  function gotoLoginWithHint(hint?: string): void {
    navigate(
      buildRelativeUrl("/login", {
        token: token || undefined,
        redirect_uri: redirectUri || undefined,
        state: state || undefined,
        response_type: searchParams.get("response_type") || undefined,
        client_id: clientId || undefined,
        code_challenge: codeChallenge || undefined,
        code_challenge_method: codeChallengeMethod || undefined,
        scope: scope || undefined,
        login_hint: hint || undefined,
      })
    );
  }

  async function handleChooseAccount(entry: DeviceAccount): Promise<void> {
    // Google/Meta/Apple multi-account UX: selecting ANY signed-in account
    // (active OR a sibling slot) should reveal the consent screen WITHOUT
    // asking for the password again. The durable per-slot refresh cookie
    // (`oxy_rt_${authuser}`) lets us silently mint a fresh access token via
    // `POST /auth/refresh?authuser=N`. Only when that mint fails (the slot's
    // cookie has expired or been revoked server-side) do we fall back to
    // `/login` with a hint to make the user re-authenticate explicitly.
    //
    // The active account already has a token planted by `useDeviceAccounts`,
    // so it can short-circuit straight to the consent reveal.
    if (entry.isCurrent) {
      const planted = sessionStorage.getItem("oxy_access_token");
      if (!planted) {
        gotoLoginWithHint(entry.account.username || entry.account.email);
        return;
      }
      sessionStorage.setItem("oxy_session_id", entry.sessionId);
      setData((prev) => ({ ...prev, sessionId: entry.sessionId }));
      setChooserDismissed(true);
      return;
    }

    // Sibling slot: pre-mint silently via the per-slot refresh cookie.
    // Without a known `authuser` slot index we cannot target a specific
    // cookie — fall back to explicit re-auth.
    if (typeof entry.authuser !== "number") {
      gotoLoginWithHint(entry.account.username || entry.account.email);
      return;
    }

    setChooserPendingSessionId(entry.sessionId);
    try {
      const refreshUrl = `${buildAuthUrl("/refresh")}?authuser=${encodeURIComponent(
        String(entry.authuser)
      )}`;
      const response = await fetch(refreshUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
      });
      if (!response.ok) {
        // 401 = slot cookie expired/revoked; any other non-2xx = transient
        // server error. Both route to explicit re-auth so the user is never
        // stuck on a spinning chooser row.
        gotoLoginWithHint(entry.account.username || entry.account.email);
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { accessToken?: string; expiresAt?: string }
        | null;
      if (!payload?.accessToken) {
        gotoLoginWithHint(entry.account.username || entry.account.email);
        return;
      }
      // Plant the freshly-minted access token + sibling sessionId so the
      // consent reveal (and the downstream `/token` / `/authorize` exchange)
      // sees the SAME credentials the active row would have provided.
      sessionStorage.setItem("oxy_access_token", payload.accessToken);
      sessionStorage.setItem("oxy_session_id", entry.sessionId);
      setData((prev) => ({
        ...prev,
        sessionId: entry.sessionId,
        user: {
          id: entry.account.id,
          username: entry.account.username,
          email: entry.account.email,
          avatar: entry.account.avatar,
          displayName: entry.account.displayName,
        },
      }));
      setChooserDismissed(true);
    } catch {
      // Network failure: explicit re-auth, never silent retry.
      gotoLoginWithHint(entry.account.username || entry.account.email);
    } finally {
      setChooserPendingSessionId(null);
    }
  }

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
  const application = data.application;
  const expiresAt = data.expiresAt;
  const currentUser = data.user;
  const displayName = currentUser ? getAccountDisplayName(currentUser) : null;
  const userEmail = currentUser?.email;
  const showActions =
    !pageError && (!effectiveStatus || effectiveStatus === "pending");

  // OAuth code flow: prefer the explicitly requested `scope` URL param (space-
  // separated) over the application's full configured scope list. Empty for the
  // device flow, where the card falls back to base permissions.
  const requestedScopes = scope
    ? scope.split(/\s+/).filter((s) => s.length > 0)
    : [];

  const loginUrl = buildRelativeUrl("/login", {
    token: token || undefined,
    redirect_uri: redirectUri || undefined,
    state: state || undefined,
  });

  // Additive front screen: when the consent request is still actionable and at
  // least one account is signed in on this device, show the Google-style
  // chooser first. Selecting the active account plants its token and dismisses
  // the chooser to reveal the consent UI below; other accounts re-route to
  // /login. The chooser never intercepts a completed (approved/denied) state.
  if (showActions && !chooserDismissed && chooserSessionId && deviceAccounts.length > 0) {
    return (
      <AccountChooser
        accounts={deviceAccounts}
        appName={application?.name}
        onSelectAccount={handleChooseAccount}
        onUseAnother={() => gotoLoginWithHint()}
        pendingSessionId={chooserPendingSessionId}
        isLoading={submitting || chooserPendingSessionId !== null}
      />
    );
  }

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

          {/* Resolved requesting-application identity + requested scopes.
              Rendered only when the application resolved — there is no generic
              "This app" fallback. An unresolved request surfaces as the error
              box below instead. */}
          {application ? (
            <AppIdentityCard
              app={application}
              requestedScopes={requestedScopes}
            />
          ) : (
            <AuthFormHeader
              title="Authorization request"
              description="We couldn't load the details of this request."
            />
          )}

          {/* Error state */}
          {pageError && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {pageError}
            </div>
          )}

          {/* Action section */}
          {showActions ? (
            <>
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
