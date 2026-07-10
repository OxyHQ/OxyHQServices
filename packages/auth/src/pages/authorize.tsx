import { useEffect, useRef, useState } from "react";
import { useSearchParams, Link, useNavigate, Navigate } from "react-router-dom";
import type { PublicApplication, SwitchableAccount } from "@oxyhq/core";
import { OxyConsentScreen, useOxy, useSwitchableAccounts } from "@oxyhq/services";

import { Button } from "@oxyhq/bloom/button";
import {
  AuthFormLayout,
  AuthFormHeader,
  LoadingSpinner,
  isChildWindow,
  tryCloseChildWindow,
} from "@/components/auth-form-layout";
import { AccountChooser } from "@/components/account-chooser";
import { useTranslation } from "@/lib/i18n/use-translation";
import {
  sessionStatusSchema,
  safeParse,
  consentRequiredFromBody,
} from "@/lib/schemas";
import {
  buildRelativeUrl,
  buildAuthUrl,
  buildApiUrl,
  getAvatarUrl,
} from "@/lib/oxy-api-client";

/**
 * The requesting-application + auth-request resolution state. The signed-in
 * USER, the access token, and the device session id come from the device-first
 * SDK (`useOxy().user` / `oxyServices.getAccessToken()` / `useSwitchableAccounts`)
 * — the IdP no longer resolves per-account bearers itself.
 */
type AuthorizeData = {
  sessionStatus: string | null;
  application: PublicApplication | null;
  expiresAt: string | null;
  error: string | null;
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
      // Apex origins only — never propagate the spurious trailing slash from
      // `URL.toString()` or `redirect_uri=https://app.example/`.
      if (parsed.pathname === "/" && !parsed.search && !parsed.hash) {
        return parsed.origin;
      }
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
  const prompt = searchParams.get("prompt");
  const statusParam = searchParams.get("status");
  const urlError = searchParams.get("error");

  // Device-first SDK: the signed-in user + active bearer + device account set.
  // The bearer for the OAuth authorize call is ALWAYS the SDK's active-account
  // token; switching accounts (`switchToAccount`) re-plants it — there is no
  // per-row bearer anymore.
  const {
    user,
    oxyServices,
    switchToAccount,
    isAuthResolved,
    isAuthenticated,
  } = useOxy();
  const {
    accounts: deviceAccounts,
    currentSessionId,
    isLoading: deviceAccountsLoading,
  } = useSwitchableAccounts();

  const [data, setData] = useState<AuthorizeData>({
    sessionStatus: statusParam,
    application: null,
    expiresAt: null,
    error: urlError,
  });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  // OAuth code path only: when the server says consent isn't required (trusted
  // app, or a stored grant already covers the requested scopes) we authorize
  // and redirect WITHOUT rendering the consent screen. While that POST + redirect
  // is in flight we show a neutral "Signing you in…" backdrop.
  const [autoApproving, setAutoApproving] = useState(false);

  // Google-style account chooser shown as an additive front screen before the
  // consent UI when MORE THAN ONE account is signed in on this device. Selecting
  // a row switches into it (the uniform device-first switch), re-planting the
  // active bearer, then reveals consent (or auto-approves). A single-account
  // device skips the chooser and goes straight to consent for the active account.
  const [chooserDismissed, setChooserDismissed] = useState(false);
  // The accountId currently being switched-to. Shown as a per-row busy state in
  // `<AccountChooser>` and disables sibling rows so the user can't fire a second
  // switch while one is in flight. Cleared on success (consent reveal) or on
  // failure (re-auth fallback).
  const [chooserPendingAccountId, setChooserPendingAccountId] = useState<
    string | null
  >(null);
  // The auto-approve probe runs at most once per mount for the active account.
  const autoApproveAttemptedRef = useRef(false);

  // OAuth `prompt=none`: silent cross-origin restore — never show login UI.
  // Fail with standard OAuth errors back to the RP redirect_uri.
  function redirectOAuthError(errorCode: string): void {
    const safeRedirect = safeRedirectUrl(redirectUri);
    if (!safeRedirect) {
      setData((prev) => ({ ...prev, error: errorCode }));
      return;
    }
    const url = new URL(safeRedirect);
    url.searchParams.set("error", errorCode);
    if (state) url.searchParams.set("state", state);
    window.location.href = url.toString();
  }

  // Silent restore: when prompt=none and the IdP has no session, bounce
  // `login_required` immediately (OAuth standard) instead of the login page.
  // Wait until device-first cold boot finishes so we don't race a slow mint.
  useEffect(() => {
    if (prompt !== "none" || !isAuthResolved || deviceAccountsLoading) return;
    if (isAuthenticated || currentSessionId || deviceAccounts.length > 0) return;
    redirectOAuthError("login_required");
  }, [
    prompt,
    isAuthResolved,
    isAuthenticated,
    currentSessionId,
    deviceAccounts.length,
    deviceAccountsLoading,
  ]);

  // Silent restore with an IdP session: probe consent and auto-approve without UI.
  useEffect(() => {
    if (
      prompt !== "none" ||
      !isAuthResolved ||
      deviceAccountsLoading ||
      !isAuthenticated ||
      !clientId ||
      autoApproveAttemptedRef.current
    ) {
      return;
    }
    autoApproveAttemptedRef.current = true;
    void (async () => {
      const token = oxyServices.getAccessToken();
      if (!token) {
        redirectOAuthError("login_required");
        return;
      }
      const safeRedirect = safeRedirectUrl(redirectUri);
      if (!safeRedirect) return;

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
            headers: { Authorization: `Bearer ${token}` },
          }
        );
        if (response.ok) {
          body = await response.json().catch(() => null);
        }
      } catch {
        body = null;
      }

      if (consentRequiredFromBody(body)) {
        setAutoApproving(false);
        redirectOAuthError("consent_required");
        return;
      }

      await runOAuthAuthorize(token, safeRedirect);
    })();
  }, [
    prompt,
    isAuthResolved,
    isAuthenticated,
    clientId,
    redirectUri,
    scope,
    state,
    oxyServices,
    deviceAccountsLoading,
  ]);

  useEffect(() => {
    async function loadData() {
      try {
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
                sessionStatus: null,
                application,
                expiresAt: null,
                error: application ? null : UNRESOLVED_APP_ERROR,
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
                sessionStatus: sessionInfo.status,
                application,
                expiresAt: null,
                error: err,
              });
              return;
            }

            setData({
              sessionStatus: sessionInfo.status,
              application,
              expiresAt: sessionInfo.expiresAt ?? null,
              error: application ? null : UNRESOLVED_APP_ERROR,
            });
            return;
          } catch (err) {
            setData({
              sessionStatus: null,
              application: oauthApplication,
              expiresAt: null,
              error:
                err instanceof Error
                  ? err.message
                  : "Unable to load request.",
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
          sessionStatus: statusParam,
          application: oauthApplication,
          expiresAt: null,
          error: resolvedError,
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

  async function handleChooseAccount(entry: SwitchableAccount): Promise<void> {
    setChooserPendingAccountId(entry.accountId);
    try {
      // Switching into the account re-plants the active bearer; with a token in
      // hand the OAuth path can skip the consent screen when consent isn't
      // required. The active account needs no switch.
      if (!entry.isCurrent) {
        await switchToAccount(entry.accountId);
      }
      setChooserDismissed(true);
      await maybeAutoApprove(oxyServices.getAccessToken());
    } catch {
      gotoLoginWithHint(entry.user.username ?? undefined);
    } finally {
      setChooserPendingAccountId(null);
    }
  }

  // Single-account device (or once the chooser is dismissed): probe consent for
  // the active account and auto-approve when it isn't required. Runs at most once
  // per mount. Multi-account devices go through the chooser first.
  useEffect(() => {
    if (
      deviceAccountsLoading ||
      autoApproveAttemptedRef.current ||
      data.error ||
      (data.sessionStatus && data.sessionStatus !== "pending") ||
      !currentSessionId ||
      deviceAccounts.length > 1
    ) {
      return;
    }
    autoApproveAttemptedRef.current = true;
    void maybeAutoApprove(oxyServices.getAccessToken());
  }, [
    deviceAccounts.length,
    deviceAccountsLoading,
    currentSessionId,
    data.error,
    data.sessionStatus,
    oxyServices,
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
      if (!response.ok) {
        // Misconfigured redirect_uri (common prod drift) returns 403 before the
        // trusted-app auto-approve branch runs. Fail closed with a visible error
        // instead of falling through to the consent screen — official apps should
        // never prompt here.
        if (response.status === 403 || response.status === 400) {
          const errPayload = await response.json().catch(() => ({}));
          const message =
            typeof errPayload?.message === "string"
              ? errPayload.message
              : "Authorization failed. Return to the app and try again.";
          setAutoApproving(false);
          setData((prev) => ({ ...prev, error: message }));
          return;
        }
        body = null;
      } else {
        body = await response.json().catch(() => null);
      }
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
      // The bearer is ALWAYS the SDK's active-account token (planted at sign-in /
      // account switch) — never a per-row bearer.
      const accessToken = oxyServices.getAccessToken();

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

  if (prompt === "none") {
    return (
      <AuthFormLayout>
        <AuthFormHeader title={t("authorize.signingIn")} />
        <LoadingSpinner />
      </AuthFormLayout>
    );
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

  // No session on this device (cold boot has resolved and found none) — redirect
  // to login carrying the full request context. Skip for `prompt=none` (handled above).
  if (
    prompt !== "none" &&
    isAuthResolved &&
    !isAuthenticated &&
    !currentSessionId &&
    deviceAccounts.length === 0
  ) {
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
  // Actionable = the request itself is still live (pending). A transient
  // submit error (e.g. a 403/500 from the authorize POST) keeps the consent
  // surface — with the application identity — visible, shown inline via the
  // consent screen's `error` prop so the user can retry. Terminal states
  // (expired/cancelled) fall through to the page status view instead.
  const showActions = !effectiveStatus || effectiveStatus === "pending";

  // Additive front screen: when the consent request is still actionable and MORE
  // THAN ONE account is signed in on this device, show the Google-style chooser
  // first. Selecting an account switches into it and reveals the consent UI. A
  // single-account device skips straight to consent for the active account. The
  // chooser never intercepts a completed (approved/denied) state.
  if (
    showActions &&
    !chooserDismissed &&
    currentSessionId &&
    deviceAccounts.length > 1
  ) {
    return (
      <AccountChooser
        accounts={deviceAccounts}
        appName={application?.name}
        onSelectAccount={handleChooseAccount}
        onUseAnother={() => gotoLoginWithHint()}
        pendingAccountId={chooserPendingAccountId}
        isLoading={submitting || chooserPendingAccountId !== null}
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
      ) : application && showActions ? (
        /* Resolved requesting-application identity AND an actionable request →
           the shared services `OxyConsentScreen` (the RN/Bloom consent surface,
           bundled for web via react-native-web). It is purely presentational;
           every decision is delegated back to the unchanged IdP `handleDecision`
           flow. The block wrapper keeps the RN `ScrollView` (flex:1) at content
           height inside the centered auth card instead of collapsing to zero.

           Gated on `showActions` so a non-actionable request (expired /
           cancelled, or a transient decision error) never renders a consent
           surface with dead Allow/Deny buttons — those fall through to the
           page's status view below. `showActions` already implies `!pageError`,
           so the consent surface is only ever shown error-free (no `error` prop
           needed). */
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
              user
                ? {
                    displayName: user.name?.displayName,
                    handle: user.username,
                    avatarUri: user.avatar
                      ? getAvatarUrl(user.avatar)
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
        /* Either no resolved application, or a resolved application whose request
           is no longer actionable (expired / cancelled / errored). Render the
           page's status view — message + error — never a consent surface. */
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
