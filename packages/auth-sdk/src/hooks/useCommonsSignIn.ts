/**
 * useCommonsSignIn — the reusable web "Sign in with Oxy" (QR) hook.
 *
 * "Sign in with Oxy" is the user-facing label for the cross-device handoff:
 * a relying-party web app SHOWS a QR; the user's Oxy app (Commons) scans and
 * approves on their phone (where the private key lives); the web app polls and
 * claims the resulting session. The web side never holds a private key.
 *
 * This hook owns the full web initiator lifecycle over the core device-flow
 * primitives ({@link OxyServices.startCommonsSignIn} →
 * {@link OxyServices.pollCommonsSignIn} → {@link OxyServices.claimSessionByToken}):
 *   1. `start()` registers a session and renders `qrPayload` to a QR image,
 *   2. it polls for approval (socket-free; the device-flow status endpoint is
 *      the authoritative backstop the services socket also falls back to),
 *   3. on approval it claims the secret `sessionToken` for the first access
 *      token and hands the committed session to `onAuthenticated`.
 *
 * Provider integration: when rendered inside a {@link WebOxyProvider} and called
 * with no explicit options, it resolves `oxyServices` + `clientId` from context
 * and commits through the provider's session path
 * ({@link WebOxyContextValue.commitClaimedSession}). Passing explicit options
 * (the IdP, standalone surfaces) overrides that — the hook never requires a
 * provider.
 *
 * The poll/expiry timers are managed imperatively from `start()`/`reset()` (an
 * event-driven subscription, not derived state); the only effect is unmount
 * cleanup plus an optional one-shot `autoStart`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { OxyServices, User, CommonsSignInStatus } from '@oxyhq/core';
import { establishIdpSessionAfterClaim } from '@oxyhq/core';
import { renderQrDataUrl } from '../utils/qrCode';
import { useWebOxyOptional } from '../WebOxyProvider';

/** Lifecycle phase of a web "Sign in with Oxy" flow. */
export type CommonsSignInPhase =
  /** Not started. */
  | 'idle'
  /** Creating the device-flow session + rendering the QR. */
  | 'starting'
  /** QR is shown; awaiting approval from the user's Oxy app. */
  | 'waiting'
  /** Approved; claiming the session (minting the first access token). */
  | 'authorizing'
  /** Claimed and committed. */
  | 'authorized'
  /** The approver explicitly denied the request. */
  | 'denied'
  /** The session expired before approval. */
  | 'expired'
  /** A non-recoverable error occurred (network, config, claim failure). */
  | 'error';

/**
 * Result of a successful claim — the device-flow equivalent of an OAuth
 * code-for-token exchange. Mirrors {@link OxyServices.claimSessionByToken}.
 */
export interface CommonsClaimResult {
  accessToken: string;
  sessionId: string;
  deviceId: string;
  expiresAt: string;
  user: User;
}

export interface UseCommonsSignInOptions {
  /**
   * The OxyServices client to drive the flow. Omit inside a
   * {@link WebOxyProvider} to use the provider's instance.
   */
  oxyServices?: OxyServices;
  /**
   * The relying party's registered OAuth client id (ApplicationCredential
   * publicKey). Required so the server can resolve the requesting app's
   * identity for the approval screen. Omit inside a {@link WebOxyProvider} to
   * use the provider's configured `clientId`.
   */
  clientId?: string | null;
  /**
   * Called after the session is claimed. Omit inside a {@link WebOxyProvider}
   * to commit through the provider's session path automatically.
   */
  onAuthenticated?: (result: CommonsClaimResult) => void | Promise<void>;
  /** Surface non-recoverable errors (network, config, claim failure). */
  onError?: (error: Error) => void;
  /** Status poll interval in ms (default 2500). */
  pollIntervalMs?: number;
  /** Rendered QR image width in pixels (default 240). */
  qrWidth?: number;
  /** Begin the flow automatically on mount (default false). */
  autoStart?: boolean;
}

export interface UseCommonsSignInResult {
  /** Current lifecycle phase. */
  phase: CommonsSignInPhase;
  /** Raw deep-link payload (`oxycommons://approve?...`), or `null`. */
  qrPayload: string | null;
  /** PNG `data:` URL of the rendered QR for `<img src>`, or `null`. */
  qrImageDataUrl: string | null;
  /** Server-authoritative expiry (epoch ms), or `null`. */
  expiresAt: number | null;
  /** A user-facing error message, or `null`. */
  error: string | null;
  /** `true` while a flow is in progress (`starting` | `waiting` | `authorizing`). */
  isActive: boolean;
  /** Begin (or restart) the flow: create a session, render the QR, start polling. */
  start: () => void;
  /** Cancel the flow and clear all state back to `idle`. Idempotent. */
  reset: () => void;
}

const DEFAULT_POLL_INTERVAL_MS = 2500;

export function useCommonsSignIn(
  options: UseCommonsSignInOptions = {},
): UseCommonsSignInResult {
  const ctx = useWebOxyOptional();

  const oxyServices = options.oxyServices ?? ctx?.oxyServices;
  const clientId = options.clientId ?? ctx?.clientId ?? null;
  const onAuthenticated =
    options.onAuthenticated ?? (ctx ? ctx.commitClaimedSession : undefined);
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const qrWidth = options.qrWidth ?? 240;

  const [phase, setPhase] = useState<CommonsSignInPhase>('idle');
  const [qrPayload, setQrPayload] = useState<string | null>(null);
  const [qrImageDataUrl, setQrImageDataUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Latest callbacks read via refs so the long-lived poll/claim closures never
  // capture a stale `onAuthenticated` / `onError` from an earlier render.
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  // Per-run guard: every `start()`/`reset()` bumps `runIdRef`. Stale async work
  // (an in-flight poll/claim from a superseded run) compares its captured id and
  // no-ops, so a restart or unmount can never commit an old flow.
  const runIdRef = useRef(0);
  const sessionTokenRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processingRef = useRef(false);
  const mountedRef = useRef(true);

  const stopTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current);
      expiryTimerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    runIdRef.current += 1;
    stopTimers();
    processingRef.current = false;
    sessionTokenRef.current = null;
    setPhase('idle');
    setQrPayload(null);
    setQrImageDataUrl(null);
    setExpiresAt(null);
    setError(null);
  }, [stopTimers]);

  const fail = useCallback((runId: number, message: string) => {
    if (runId !== runIdRef.current || !mountedRef.current) return;
    stopTimers();
    processingRef.current = false;
    setError(message);
    setPhase('error');
    onErrorRef.current?.(new Error(message));
  }, [stopTimers]);

  const claimAndCommit = useCallback(
    async (svc: OxyServices, token: string, runId: number) => {
      if (runId !== runIdRef.current) return;
      setPhase('authorizing');
      try {
        const result = await svc.claimSessionByToken(token);
        if (runId !== runIdRef.current || !mountedRef.current) return;
        setPhase('authorized');
        await onAuthenticatedRef.current?.(result);
        // WEB durable-session hop (shared core primitive — identical to the
        // `@oxyhq/services` device-flow path). A QR claim plants only in-memory
        // tokens: no IdP `fedcm_session` cookie, so a reload would lose the
        // session. Now that the session is committed + durably persisted by
        // `onAuthenticated`, plant the per-apex IdP cookie via ONE establish hop.
        // Total (never throws) and no-op on the IdP origin; a single attempt that
        // navigates away on success. Not fired for the SSO-return/silent paths —
        // only this device-flow claim needs it.
        await establishIdpSessionAfterClaim(svc, {});
      } catch (err) {
        fail(runId, err instanceof Error ? err.message : 'Failed to complete sign in.');
      }
    },
    [fail],
  );

  const start = useCallback(() => {
    if (!oxyServices) {
      const message = 'Sign-in is unavailable (missing Oxy client).';
      setError(message);
      setPhase('error');
      onErrorRef.current?.(new Error(message));
      return;
    }
    if (!clientId) {
      const message = 'This app is not configured for sign-in (missing clientId).';
      setError(message);
      setPhase('error');
      onErrorRef.current?.(new Error(message));
      return;
    }

    // Supersede any in-flight run, then begin a fresh one.
    runIdRef.current += 1;
    const runId = runIdRef.current;
    stopTimers();
    processingRef.current = false;
    sessionTokenRef.current = null;
    setError(null);
    setQrPayload(null);
    setQrImageDataUrl(null);
    setExpiresAt(null);
    setPhase('starting');

    const svc = oxyServices;

    void (async () => {
      try {
        const handle = await svc.startCommonsSignIn({ clientId });
        if (runId !== runIdRef.current || !mountedRef.current) return;

        const dataUrl = await renderQrDataUrl(handle.qrPayload, qrWidth);
        if (runId !== runIdRef.current || !mountedRef.current) return;

        sessionTokenRef.current = handle.sessionToken;
        setQrPayload(handle.qrPayload);
        setQrImageDataUrl(dataUrl);
        setExpiresAt(handle.expiresAt);
        setPhase('waiting');

        // Expiry backstop: the server also enforces it, but the local timer
        // moves the UI to `expired` even if the final poll is in flight.
        const ttl = handle.expiresAt - Date.now();
        expiryTimerRef.current = setTimeout(() => {
          if (runId !== runIdRef.current || !mountedRef.current) return;
          stopTimers();
          setPhase('expired');
        }, Math.max(ttl, 0));

        pollTimerRef.current = setInterval(() => {
          if (processingRef.current) return;
          const token = sessionTokenRef.current;
          if (!token) return;

          void (async () => {
            let status: CommonsSignInStatus;
            try {
              status = await svc.pollCommonsSignIn(token);
            } catch {
              // Transient poll error — the next tick retries.
              return;
            }
            if (runId !== runIdRef.current || !mountedRef.current) return;

            if (status.authorized && status.sessionId) {
              processingRef.current = true;
              stopTimers();
              await claimAndCommit(svc, token, runId);
            } else if (status.status === 'cancelled') {
              stopTimers();
              setPhase('denied');
            } else if (status.status === 'expired') {
              stopTimers();
              setPhase('expired');
            }
          })();
        }, pollIntervalMs);
      } catch (err) {
        fail(runId, err instanceof Error ? err.message : 'Failed to start sign in.');
      }
    })();
  }, [oxyServices, clientId, qrWidth, pollIntervalMs, stopTimers, claimAndCommit, fail]);

  // Optional one-shot auto-start. Guarded so it never re-fires when `start`
  // changes identity across renders.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (options.autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true;
      start();
    }
  }, [options.autoStart, start]);

  // Unmount cleanup: supersede the run and tear down timers.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runIdRef.current += 1;
      stopTimers();
    };
  }, [stopTimers]);

  return {
    phase,
    qrPayload,
    qrImageDataUrl,
    expiresAt,
    error,
    isActive: phase === 'starting' || phase === 'waiting' || phase === 'authorizing',
    start,
    reset,
  };
}
