/**
 * useOxyAuthSession — the single shared engine for the cross-app device-flow
 * sign-in ("Sign in with Oxy") used by BOTH containers:
 *
 *   - `SignInModal` (web centered modal)
 *   - `OxyAuthScreen` (native bottom sheet)
 *
 * Before this hook existed, those two files each re-implemented ~90% of the
 * same auth-session machinery (session-token creation, QR data, socket.io
 * `/auth-session` subscription, the HTTP polling fallback, waiting/error/retry
 * state, the open-auth handler, and cleanup) — and they had drifted (notably a
 * weaker `Math.random()` session token on native vs the crypto-secure one on
 * web). This hook owns ALL of it ONCE, with a clean typed surface, so the
 * containers only own their layout. The transport is functionally identical to
 * the previous implementations — this is a structural de-duplication, not a
 * behavior change.
 *
 * The native-only deep-link return path (`Linking` redirect handling) lives
 * HERE, gated to native via `Platform.OS`, so the web container never carries
 * native-only code while the two paths still cannot drift.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Linking, Platform } from 'react-native';
import io, { type Socket } from 'socket.io-client';
import type { OxyServices, User } from '@oxyhq/core';
import { createDebugLogger } from '@oxyhq/core';
import { completeDeviceFlowSignIn } from '../../utils/deviceFlowSignIn';

const debug = createDebugLogger('useOxyAuthSession');

/**
 * Default destination for the "Create an Oxy account" / "Get Oxy Accounts"
 * link, shared by both containers. Reused as-is from the original native
 * `OxyAuthScreen` so no new route is invented.
 */
export const OXY_ACCOUNTS_WEB_URL = 'https://accounts.oxy.so';

/** Default central Oxy auth web origin used when no override can be resolved. */
export const OXY_AUTH_WEB_URL = 'https://auth.oxy.so';

/** Auth session expiration (5 minutes). */
export const AUTH_SESSION_EXPIRY_MS = 5 * 60 * 1000;

/** Polling interval (fallback if the socket fails) in milliseconds. */
export const POLLING_INTERVAL_MS = 3000;

/** The active device-flow session this client created and is waiting on. */
export interface AuthSession {
  /** The secret high-entropy token that IS the device-flow credential. */
  sessionToken: string;
  /** Epoch ms after which the server rejects this session. */
  expiresAt: number;
}

/**
 * Extended `POST /auth/session/create` response (the "Sign in with Oxy" handoff
 * fields, Workstream C2). Both are optional so this hook degrades gracefully
 * when the handoff backend is not yet deployed — the legacy `oxyauth://<token>`
 * QR (`qrData`) remains the fallback.
 */
interface AuthSessionCreateResponse {
  /**
   * Public, single-use authorize code carried in the QR / deep-link. NEVER the
   * secret `sessionToken` — the approver resolves the requesting app's identity
   * from this code server-side.
   */
  authorizeCode?: string;
  /** Ready-to-render deep-link / universal-link string (`oxycommons://approve?...`). */
  qrPayload?: string;
  /** Session lifecycle status (e.g. `'pending'`). */
  status?: string;
  /** Server-authoritative expiry (epoch ms); the client-proposed value is the fallback. */
  expiresAt?: number;
}

/** Real-time auth-session socket payload (also matches the poll status shape). */
interface AuthUpdatePayload {
  status: 'authorized' | 'cancelled' | 'expired';
  sessionId?: string;
  publicKey?: string;
  userId?: string;
  username?: string;
}

export interface UseOxyAuthSessionOptions {
  /**
   * Called after a fully completed sign-in (bearer claimed, session hydrated).
   * The web modal closes itself here; the native screen forwards the user to
   * its `onAuthenticated` prop. The hook itself stays presentation-agnostic.
   */
  onSignedIn?: (user: User) => void;
}

export interface UseOxyAuthSessionResult {
  /** The active device-flow session, or `null` before/while it is created. */
  authSession: AuthSession | null;
  /** The QR payload string (`oxyauth://<token>`), or `''` when no session. */
  qrData: string;
  /**
   * The PUBLIC, single-use authorize code for the "Sign in with Oxy" handoff,
   * or `null` when the handoff backend did not return one. The approver (the
   * Oxy identity app) resolves the requesting app's identity from this code —
   * it is safe to display; it is NOT the secret `sessionToken`.
   */
  authorizeCode: string | null;
  /**
   * The structured "Sign in with Oxy" deep-link payload
   * (`oxycommons://approve?...`) to render in the cross-device QR and to open on
   * the same device, or `null` when the handoff backend did not return one.
   * Render this (preferred over `qrData`) in the QR and pass it to
   * `Linking.openURL` for same-device approval.
   */
  qrPayload: string | null;
  /** `true` while the session is being created (initial spinner). */
  isLoading: boolean;
  /** A user-facing error message, or `null`. Drives the retry UI. */
  error: string | null;
  /** `true` once a session exists and we are awaiting authorization. */
  isWaiting: boolean;
  /**
   * Open the central Oxy auth approval surface for THIS device-flow session.
   * On web this opens a centered approval popup; on native it opens the system
   * browser (carrying a `redirect_uri` so the deep-link return path can fire).
   * This is the action behind the platform-primary "Continue with Oxy" button.
   */
  openAuthApproval: () => Promise<void>;
  /**
   * Same-device "Sign in with Oxy" handoff: deep-link to `qrPayload`
   * (`oxycommons://approve?...`) so the native Oxy identity app opens directly
   * to approve. No-op when no `qrPayload` was returned. The socket / poll still
   * completes the sign-in once the approval lands.
   */
  openSameDeviceApproval: () => Promise<void>;
  /** Tear down the current session and create a fresh one (the retry action). */
  retry: () => void;
  /** Disconnect the socket and stop polling. Idempotent. */
  cleanup: () => void;
}

/**
 * Resolve the central Oxy auth web origin from config or the API base URL.
 * Mirrors the resolution both containers previously inlined.
 */
function resolveAuthWebBaseUrl(baseURL: string, authWebUrl?: string): string {
  if (authWebUrl) {
    return authWebUrl;
  }

  try {
    const url = new URL(baseURL);
    if (url.port === '3001') {
      url.port = '3002';
      return url.origin;
    }
    if (url.hostname.startsWith('api.')) {
      url.hostname = `auth.${url.hostname.slice(4)}`;
      return url.origin;
    }
  } catch {
    // Malformed base URL — fall back to the default origin below.
  }
  return OXY_AUTH_WEB_URL;
}

/**
 * Resolve the deep-link redirect URI used on native so the auth web flow can
 * bounce back into the app. Prefers an explicit config value, otherwise derives
 * a clean (query/hash-stripped) URI from the app's initial deep link.
 */
async function resolveAuthRedirectUri(authRedirectUri?: string): Promise<string | null> {
  if (authRedirectUri) {
    return authRedirectUri;
  }

  try {
    const initialUrl = await Linking.getInitialURL();
    if (!initialUrl) {
      return null;
    }

    const parsed = new URL(initialUrl);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Parse the `session_id` / `error` params from a deep-link redirect URL. */
function getRedirectParams(url: string): { sessionId?: string; error?: string } | null {
  try {
    const parsed = new URL(url);
    const sessionId = parsed.searchParams.get('session_id') ?? undefined;
    const error = parsed.searchParams.get('error') ?? undefined;

    if (!sessionId && !error) {
      return null;
    }

    return { sessionId, error };
  } catch {
    return null;
  }
}

/**
 * Generate a cryptographically random session token.
 *
 * 16 random bytes -> 32 hex chars (128 bits of entropy) — unguessable.
 * `crypto.getRandomValues` is guaranteed available because importing
 * `@oxyhq/core` installs a polyfill via `expo-crypto` on React Native. This is
 * the secure generator the web modal already used; the native screen previously
 * used a weaker `Math.random()` generator, which this consolidation removes.
 */
function generateSessionToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Owns the full device-flow auth-session lifecycle for one mounted sign-in
 * surface. Both `SignInModal` and `OxyAuthScreen` consume this; neither
 * re-implements the socket / polling / deep-link transport.
 *
 * Subscriptions (socket connect/disconnect, the poll interval, the native
 * deep-link listener, and unmount cleanup) are the legitimate `useEffect` use
 * WITH cleanup. No effect here computes derived UI state.
 */
export function useOxyAuthSession(
  oxyServices: OxyServices,
  clientId: string | null,
  switchSession: ((sessionId: string) => Promise<User>) | undefined,
  options: UseOxyAuthSessionOptions = {},
): UseOxyAuthSessionResult {
  const { onSignedIn } = options;

  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isWaiting, setIsWaiting] = useState(false);
  // "Sign in with Oxy" handoff fields surfaced from the `create` response.
  const [authorizeCode, setAuthorizeCode] = useState<string | null>(null);
  const [qrPayload, setQrPayload] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isProcessingRef = useRef(false);
  const linkingHandledRef = useRef(false);

  // The latest `onSignedIn` callback, read via ref so the success handler does
  // not need it in its dependency list (which would otherwise rebuild the
  // socket/poll callbacks on every render where the container passes a new
  // closure).
  const onSignedInRef = useRef(onSignedIn);
  onSignedInRef.current = onSignedIn;

  // Cleanup socket and polling. Idempotent.
  const cleanup = useCallback(() => {
    setIsWaiting(false);

    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
  }, []);

  // Handle successful authorization.
  //
  // The auth-session socket / poll (or deep-link return) hands us the
  // authorized `sessionId`. Before any session-management code can use it we
  // MUST first exchange the secret `sessionToken` (held only by this client,
  // generated for THIS flow) for the first access token via
  // `claimSessionByToken` — the device-flow equivalent of OAuth's
  // code-for-token exchange (RFC 8628 §3.4).
  //
  // Without that exchange the SDK has no bearer token — the session is
  // authorized server-side but the app never becomes authenticated and the UI
  // sits "Waiting for authorization..." forever. Once `claimSessionByToken`
  // plants the tokens in the HttpService, the rest of the session wiring flows
  // through the normal `switchSession` path. Shared with both containers via
  // `completeDeviceFlowSignIn` so the two paths cannot drift.
  const handleAuthSuccess = useCallback(
    async (sessionId: string, sessionToken: string) => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      try {
        if (!switchSession) {
          throw new Error('Session management unavailable');
        }
        const user = await completeDeviceFlowSignIn({
          oxyServices,
          sessionId,
          sessionToken,
          switchSession,
        });
        onSignedInRef.current?.(user);
      } catch (err) {
        debug.error('Error completing auth:', err);
        setError('Authorization successful but failed to complete sign in. Please try again.');
        isProcessingRef.current = false;
      }
    },
    [oxyServices, switchSession],
  );

  // Start polling for authorization.
  //
  // Idempotent: if a poll interval is already running this is a no-op, so the
  // `connect_error` path (which also calls this) cannot stack a second interval
  // on top of the always-on poll started in `generateAuthSession`.
  const startPolling = useCallback(
    (sessionToken: string) => {
      if (pollingIntervalRef.current) return;

      pollingIntervalRef.current = setInterval(async () => {
        if (isProcessingRef.current) return;

        try {
          const response: {
            authorized: boolean;
            sessionId?: string;
            publicKey?: string;
            status?: string;
          } = await oxyServices.makeRequest(
            'GET',
            `/auth/session/status/${sessionToken}`,
            undefined,
            { cache: false },
          );

          if (response.authorized && response.sessionId) {
            cleanup();
            // Pass the original sessionToken (in closure) through; the claim
            // exchange needs it to mint the first access token.
            handleAuthSuccess(response.sessionId, sessionToken);
          } else if (response.status === 'cancelled') {
            cleanup();
            setError('Authorization was denied.');
          } else if (response.status === 'expired') {
            cleanup();
            setError('Session expired. Please try again.');
          }
        } catch (err) {
          // Transient poll error — the next tick retries. Logged, never thrown.
          debug.log('Auth polling error:', err);
        }
      }, POLLING_INTERVAL_MS);
    },
    [oxyServices, handleAuthSuccess, cleanup],
  );

  // Connect to the auth-session socket for real-time updates.
  const connectSocket = useCallback(
    (sessionToken: string) => {
      const baseURL = oxyServices.getBaseURL();

      // Connect to the auth-session namespace (no authentication required).
      const socket = io(`${baseURL}/auth-session`, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        debug.log('Auth socket connected');
        socket.emit('join', sessionToken);
      });

      socket.on('joined', () => {
        debug.log('Joined auth session room');
      });

      socket.on('auth_update', (payload: AuthUpdatePayload) => {
        debug.log('Auth update received:', payload);

        if (payload.status === 'authorized' && payload.sessionId) {
          cleanup();
          // `sessionToken` is this flow's secret credential (in closure) — pass
          // it through so `handleAuthSuccess` can claim the first access token.
          handleAuthSuccess(payload.sessionId, sessionToken);
        } else if (payload.status === 'cancelled') {
          cleanup();
          setError('Authorization was denied.');
        } else if (payload.status === 'expired') {
          cleanup();
          setError('Session expired. Please try again.');
        }
      });

      socket.on('connect_error', (err) => {
        debug.log(
          'Socket connection error, falling back to polling:',
          err instanceof Error ? err.message : null,
        );
        // Realtime transport errored — fall back to polling. The poll is
        // already running (started unconditionally in `generateAuthSession`),
        // so `startPolling` here is a no-op backstop.
        socket.disconnect();
        startPolling(sessionToken);
      });

      socket.on('disconnect', () => {
        debug.log('Auth socket disconnected');
      });
    },
    [oxyServices, handleAuthSuccess, cleanup, startPolling],
  );

  // Generate a new auth session.
  const generateAuthSession = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    // Reset the handoff fields for the fresh session (also clears them on retry).
    setAuthorizeCode(null);
    setQrPayload(null);
    isProcessingRef.current = false;

    // The cross-app device sign-in flow identifies the requesting app by its
    // real registered OAuth client id (ApplicationCredential publicKey).
    // Without it the API cannot resolve the consent identity, so we fail fast
    // with a clear configuration error rather than creating a session the
    // server would reject.
    if (!clientId) {
      setError('This app is not configured for sign-in (missing clientId).');
      setIsLoading(false);
      return;
    }

    try {
      const sessionToken = generateSessionToken();
      const expiresAt = Date.now() + AUTH_SESSION_EXPIRY_MS;

      // Register the auth session with the server. The response carries the
      // "Sign in with Oxy" handoff fields (public `authorizeCode` + structured
      // `qrPayload`) when the handoff backend is deployed; both are optional, so
      // the legacy `oxyauth://<token>` QR path keeps working without them.
      const createResponse = await oxyServices.makeRequest<AuthSessionCreateResponse>(
        'POST',
        '/auth/session/create',
        { sessionToken, expiresAt, clientId },
        { cache: false },
      );

      setAuthSession({ sessionToken, expiresAt });
      setAuthorizeCode(createResponse?.authorizeCode ?? null);
      setQrPayload(createResponse?.qrPayload ?? null);
      setIsWaiting(true);

      // Socket is the fast path; the poll is a transport-independent backstop
      // that guarantees completion even if the socket connects but silently
      // never delivers auth_update (RN transport / idle-timeout).
      connectSocket(sessionToken);
      startPolling(sessionToken);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : null) || 'Failed to create auth session');
    } finally {
      setIsLoading(false);
    }
  }, [oxyServices, connectSocket, startPolling, clientId]);

  // Open the central Oxy auth approval surface for this device-flow session.
  // On web this is a centered popup; on native it opens the system browser,
  // carrying a `redirect_uri` so the deep-link return path can complete the
  // flow even if the socket/poll is slow.
  const openAuthApproval = useCallback(async () => {
    if (!authSession) return;

    const authBaseUrl = resolveAuthWebBaseUrl(
      oxyServices.getBaseURL(),
      oxyServices.config?.authWebUrl,
    );
    const webUrl = new URL('/authorize', authBaseUrl);
    webUrl.searchParams.set('token', authSession.sessionToken);

    if (Platform.OS === 'web') {
      // Open a separate approval window on web for the device-flow token.
      const width = 500;
      const height = 650;
      const screenWidth = window.screen?.width ?? width;
      const screenHeight = window.screen?.height ?? height;
      const left = (screenWidth - width) / 2;
      const top = (screenHeight - height) / 2;

      window.open(
        webUrl.toString(),
        'oxy-auth-approval',
        `width=${width},height=${height},left=${left},top=${top}`,
      );
      return;
    }

    // Native: carry a redirect URI so the auth web flow can bounce back in.
    const redirectUri = await resolveAuthRedirectUri(oxyServices.config?.authRedirectUri);
    if (redirectUri) {
      webUrl.searchParams.set('redirect_uri', redirectUri);
    }

    try {
      await Linking.openURL(webUrl.toString());
    } catch (err) {
      debug.error('Unable to open Oxy Auth:', err);
      setError('Unable to open Oxy Auth. Please try again or use the QR code.');
    }
  }, [authSession, oxyServices]);

  // Same-device "Sign in with Oxy" handoff: deep-link to the `qrPayload`
  // (`oxycommons://approve?...`) so the native Oxy identity app opens directly
  // to approve. The socket / poll already resolves the flow once the approval
  // lands, so this only needs to launch the deep link. No-op when the handoff
  // backend returned no `qrPayload`.
  const openSameDeviceApproval = useCallback(async () => {
    if (!qrPayload) {
      return;
    }
    try {
      await Linking.openURL(qrPayload);
    } catch (err) {
      debug.error('Unable to open the Oxy app for approval:', err);
      setError('Unable to open the Oxy app. Scan the QR code from another device instead.');
    }
  }, [qrPayload]);

  // Tear down and recreate the session (the retry action).
  const retry = useCallback(() => {
    cleanup();
    generateAuthSession();
  }, [generateAuthSession, cleanup]);

  // Handle a native deep-link return carrying the authorized session_id.
  const handleAuthRedirect = useCallback(
    (url: string) => {
      const params = getRedirectParams(url);
      if (!params) {
        return;
      }

      if (params.error) {
        cleanup();
        setError('Authorization was denied.');
        return;
      }

      if (params.sessionId) {
        // The deep-link return carries only `session_id` — the secret
        // `sessionToken` for this flow lives in component state (generated in
        // `generateAuthSession`). Without it we cannot claim the first access
        // token, so the flow would 401 in `handleAuthSuccess`. If it is somehow
        // unavailable, fall through to the socket/poll path (which carries the
        // token in closure) rather than attempting an unauthenticated claim.
        const flowSessionToken = authSession?.sessionToken;
        if (!flowSessionToken) {
          return;
        }
        cleanup();
        handleAuthSuccess(params.sessionId, flowSessionToken);
      }
    },
    [authSession, cleanup, handleAuthSuccess],
  );

  // Initialize the auth session once on mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: this must run exactly once on mount; re-running on `generateAuthSession` identity changes would recreate the session mid-flow.
  useEffect(() => {
    generateAuthSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Native-only: handle the deep-link return from the auth web flow. Gated to
  // native so the web container never carries this listener. The socket / poll
  // path still resolves the flow if no deep link arrives.
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const subscription = Linking.addEventListener('url', ({ url }) => {
      linkingHandledRef.current = true;
      handleAuthRedirect(url);
    });

    Linking.getInitialURL()
      .then((url) => {
        if (url && !linkingHandledRef.current) {
          handleAuthRedirect(url);
        }
      })
      .catch(() => {
        // Ignore linking errors; auth will still resolve via socket/polling.
      });

    return () => {
      subscription.remove();
    };
  }, [handleAuthRedirect]);

  // Clean up subscriptions on unmount.
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const qrData = authSession ? `oxyauth://${authSession.sessionToken}` : '';

  return {
    authSession,
    qrData,
    authorizeCode,
    qrPayload,
    isLoading,
    error,
    isWaiting,
    openAuthApproval,
    openSameDeviceApproval,
    retry,
    cleanup,
  };
}
