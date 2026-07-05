import { useEffect, useState } from "react";
import { useSearchParams, Link, useNavigate, Navigate } from "react-router-dom";
import type { PublicApplication } from "@oxyhq/core";
import { OxyConsentScreen } from "@oxyhq/services";

import { Button } from "@oxyhq/bloom/button";
import {
  AuthFormLayout,
  AuthFormHeader,
  LoadingSpinner,
  isChildWindow,
  tryCloseChildWindow,
} from "@/components/auth-form-layout";
import { AccountChooser } from "@/components/account-chooser";
import { useDeviceAccounts } from "@/lib/use-device-accounts";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  sessionStatusSchema,
  safeParse,
  consentRequiredFromBody,
} from "@/lib/schemas";
import type { DeviceAccount } from "@/lib/types";
import {
  buildRelativeUrl,
  buildAuthUrl,
  buildApiUrl,
  getAvatarUrl,
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
  accessToken: string | null;
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

function parseAuthuser(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseRequestedScopes(
  scopeValue: string | null,
  fallbackScopes: string[] = []
): string[] {
  const rawScopes = scopeValue
    ? scopeValue.split(/\s+/).filter(Boolean)
    : fallbackScopes;
  return Array.from(new Set(rawScopes));
}

export function AuthorizePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
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
  const requestedAuthuser = parseAuthuser(searchParams.get("authuser"));
  const statusParam = searchParams.get("status");
  const urlError = searchParams.get("error");

  const [data, setData] = useState<AuthorizeData>({
    user: null,
    sessionId: null,
    accessToken: null,
    sessionStatus: statusParam,
    application: null,
    expiresAt: null,
    error: urlError,
    redirected: false,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // OAuth code path only: when the server says consent isn't required (trusted
  // app, or a stored grant already covers the requested scopes) we authorize
  // and redirect WITHOUT rendering the consent screen. While that POST + redirect
  // is in flight we show a neutral "Signing you in…" backdrop.
  const [autoApproving, setAutoApproving] = useState(false);

  // Google-style account chooser shown as an additive front screen before the
  // consent UI. Detect accounts signed in on this device; selecting the active
  // account mints+plants its token and reveals consent, while any other account
  // re-routes to /login (the current cookie cannot mint another account's
  // token). Dismissed once a choice is made.
  const {
    accounts: deviceAccounts,
    currentSessionId: chooserSessionId,
    isLoading: deviceAccountsLoading,
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
        let sessionId: string | null = null;
        let user: UserInfo | null = null;

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
                accessToken: null,
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
                accessToken: null,
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
                accessToken: null,
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
              accessToken: null,
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
              accessToken: null,
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
          accessToken: null,
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

  // Auto-close a child approval window when authorization is complete.
  useEffect(() => {
    const effectiveStatus = data.sessionStatus;
    if (
      (effectiveStatus === "approved" || effectiveStatus === "denied") &&
      isChildWindow()
    ) {
      // Small delay so any pending redirects / postMessages can fire
      const timer = setTimeout(() => tryCloseChildWindow(), 800);
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
        client_id: clientId || undefined,
        code_challenge: codeChallenge || undefined,
        code_challenge_method: codeChallengeMethod || undefined,
        scope: scope || undefined,
        login_hint: hint || undefined,
      })
    );
  }

  function applyChosenAccount(entry: DeviceAccount): void {
    setData((prev) => ({
      ...prev,
      sessionId: entry.sessionId,
      accessToken: entry.accessToken,
      expiresAt: entry.expiresAt ?? prev.expiresAt,
      user: {
        id: entry.account.id,
        username: entry.account.username,
        email: entry.account.email,
        avatar: entry.account.avatar,
        displayName: entry.account.displayName,
      },
    }));
    setChooserDismissed(true);
  }

  async function handleChooseAccount(entry: DeviceAccount): Promise<void> {
    setChooserPendingSessionId(entry.sessionId);
    try {
      applyChosenAccount(entry);
      // Selecting an account plants its bearer; with a token in hand the OAuth
      // path can skip the consent screen when consent isn't required.
      await maybeAutoApprove(entry.accessToken);
    } catch {
      gotoLoginWithHint(entry.account.username || entry.account.email);
    } finally {
      setChooserPendingSessionId(null);
    }
  }

  useEffect(() => {
    if (
      deviceAccountsLoading ||
      chooserDismissed ||
      requestedAuthuser === null ||
      data.error ||
      (data.sessionStatus && data.sessionStatus !== "pending")
    ) {
      return;
    }

    const target = deviceAccounts.find(
      (entry) => entry.authuser === requestedAuthuser
    );
    if (target) {
      applyChosenAccount(target);
      // The `authuser` hint silently selects the account; mirror the chooser
      // path and auto-approve when the OAuth request needs no consent.
      void maybeAutoApprove(target.accessToken);
    }
  }, [
    deviceAccounts,
    deviceAccountsLoading,
    chooserDismissed,
    requestedAuthuser,
    data.error,
    data.sessionStatus,
  ]);

  // Mint a single-use OAuth code and redirect to `redirect_uri` with
  // `?code=&state=`. Shared by the explicit "Allow" button (`handleDecision`)
  // and the trusted/already-granted auto-approval path so the fetch + redirect
  // logic exists exactly once. PKCE + `state` are passed through untouched.
  async function runOAuthAuthorize(
    accessToken: string,
    safeRedirect: string
  ): Promise<void> {
    if (!clientId) return;

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
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (codeResponse.status === 401) {
      navigate(
        buildRelativeUrl("/login", {
          token: token || undefined,
          redirect_uri: redirectUri || undefined,
          state: state || undefined,
          client_id: clientId || undefined,
          code_challenge: codeChallenge || undefined,
          code_challenge_method: codeChallengeMethod || undefined,
          scope: scope || undefined,
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
      // Surface the error and drop both in-flight flags so the page falls back
      // to the consent screen (auto-approve) or re-enables the button (manual).
      setAutoApproving(false);
      setSubmitting(false);
      setData((prev) => ({ ...prev, error: message }));
      return;
    }

    const codeResult = await codeResponse.json();
    const codeData = codeResult.data || codeResult;
    const url = new URL(safeRedirect);
    url.searchParams.set("code", codeData.code);
    if (state) url.searchParams.set("state", state);
    window.location.href = url.toString();
  }

  // Ask the server whether the OAuth consent screen must be shown for this
  // (user, application, scope) tuple. A trusted app or a covering stored grant
  // returns `consentRequired: false` → we auto-approve and redirect, no
  // consent screen. SECURITY: any transport/parse failure fails safe to "show the
  // consent screen" (`consentRequiredFromBody`) — we never silently auto-approve
  // on an error. Only runs on the OAuth code path; the device-flow handoff
  // (no client_id) always shows the consent screen.
  async function maybeAutoApprove(accessToken: string | null): Promise<void> {
    const safeRedirect = safeRedirectUrl(redirectUri);
    if (!clientId || !safeRedirect || !accessToken) return;

    // Show the neutral backdrop for the whole decision so the consent screen never
    // flashes while the check is in flight. If consent turns out to be required
    // we drop the backdrop below and render the consent screen instead.
    setAutoApproving(true);

    let body: unknown = null;
    try {
      const params = new URLSearchParams();
      params.set("clientId", clientId);
      params.set("redirectUri", safeRedirect);
      if (scope) params.set("scope", scope);
      const response = await fetch(
        buildApiUrl(`/auth/oauth/consent?${params.toString()}`),
        {
          credentials: "include",
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      // A non-OK response leaves `body` null → `consentRequiredFromBody`
      // fails safe to true (consent screen shown).
      body = response.ok ? await response.json().catch(() => null) : null;
    } catch {
      body = null;
    }

    if (consentRequiredFromBody(body)) {
      setAutoApproving(false);
      return;
    }

    await runOAuthAuthorize(accessToken, safeRedirect);
  }

  async function handleDecision(decision: "approve" | "deny") {
    if (!token && !clientId) return;
    setSubmitting(true);

    const safeRedirect = safeRedirectUrl(redirectUri);

    if (decision === "deny") {
      // Cancel the auth session
      if (token) {
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
    //   - Device-flow handoff (no `client_id`): authorize the
    //     pending AuthSession via the Bearer-auth endpoint and notify the
    //     polling client via socket.io. No tokens ever appear in the URL.
    try {
      const sessionId = data.sessionId;
      const accessToken = data.accessToken;

      if (!accessToken) {
        setData((prev) => ({
          ...prev,
          error: "Sign in required to authorize this request.",
        }));
        setSubmitting(false);
        return;
      }

      // ---- OAuth2 authorization code flow ----
      if (clientId && safeRedirect) {
        await runOAuthAuthorize(accessToken, safeRedirect);
        return;
      }

      // ---- Device-flow handoff (token + AuthSession) ----
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
            Authorization: `Bearer ${accessToken}`,
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
            client_id: clientId || undefined,
            code_challenge: codeChallenge || undefined,
            code_challenge_method: codeChallengeMethod || undefined,
            scope: scope || undefined,
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

  if (loading || deviceAccountsLoading) {
    return <LoadingSpinner />;
  }

  // Trusted / already-granted OAuth request: authorizing + redirecting without
  // ever showing the consent screen. Neutral backdrop while that completes.
  if (autoApproving) {
    return (
      <AuthFormLayout>
        <AuthFormHeader title={t("authorize.signingIn")} />
        <LoadingSpinner />
      </AuthFormLayout>
    );
  }

  if (!token && !clientId) {
    return (
      <AuthFormLayout>
        <AuthFormHeader
          title={t("authorize.noRequestTitle")}
          description={t("authorize.noRequestDesc")}
        />
        <Button asChild size="lg">
          <Link to="/login">{t("authorize.goToSignIn")}</Link>
        </Button>
      </AuthFormLayout>
    );
  }

  if (!data.sessionId && !data.user && deviceAccounts.length === 0) {
    // No session - redirect to login
    return (
      <Navigate
        to={buildRelativeUrl("/login", {
          token: token || undefined,
          redirect_uri: redirectUri || undefined,
          state: state || undefined,
          client_id: clientId || undefined,
          code_challenge: codeChallenge || undefined,
          code_challenge_method: codeChallengeMethod || undefined,
          scope: scope || undefined,
        })}
        replace
      />
    );
  }

  const effectiveStatus = data.sessionStatus;
  const pageError = data.error;
  const application = data.application;
  const currentUser = data.user;
  const showActions =
    !pageError && (!effectiveStatus || effectiveStatus === "pending");

  // Additive front screen: when the consent request is still actionable and at
  // least one account is signed in on this device, show the Google-style
  // chooser first. Selecting an account keeps its bearer in memory and reveals
  // the consent UI below. The chooser never intercepts a completed
  // (approved/denied) state.
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
            title={
              effectiveStatus === "approved"
                ? t("authorize.completeTitle")
                : t("authorize.deniedTitle")
            }
            description={
              isChildWindow()
                ? t("authorize.completeChild")
                : effectiveStatus === "approved"
                  ? t("authorize.completeDesc")
                  : t("authorize.deniedDesc")
            }
          />
        </>
      ) : application ? (
        /* Resolved requesting-application identity → the shared services
           `OxyConsentScreen` (the RN/Bloom consent surface, bundled for web via
           react-native-web). It is purely presentational; every decision is
           delegated back to the unchanged IdP `handleDecision` flow. The block
           wrapper keeps the RN `ScrollView` (flex:1) at content height inside
           the centered auth card instead of collapsing to zero. An unresolved
           request surfaces as the error view below instead. */
        <div className="w-full">
          <OxyConsentScreen
            application={{
              name: application.name,
              iconUrl: application.icon,
              websiteUrl: application.websiteUrl,
              privacyPolicyUrl: application.privacyPolicyUrl,
              termsUrl: application.termsUrl,
              developerName: application.developerName,
              isOfficial: application.isOfficial,
            }}
            scopes={parseRequestedScopes(scope, application.scopes)}
            user={
              currentUser
                ? {
                    displayName: currentUser.displayName,
                    handle: currentUser.username,
                    avatarUri: currentUser.avatar
                      ? getAvatarUrl(currentUser.avatar)
                      : undefined,
                  }
                : undefined
            }
            onAllow={() => handleDecision("approve")}
            onDeny={() => handleDecision("deny")}
            busy={submitting}
            error={pageError}
          />
        </div>
      ) : (
        <>
          <AuthFormHeader
            title={t("authorize.requestTitle")}
            description={t("authorize.requestUnavailable")}
          />
          {pageError && (
            <div className="rounded-radius-12 border border-destructive/50 bg-destructive/10 p-space-12 font-bodySmall text-bodySmall text-destructive">
              {pageError}
            </div>
          )}
        </>
      )}
    </AuthFormLayout>
  );
}
