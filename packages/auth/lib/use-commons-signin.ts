/**
 * useCommonsSignIn — the IdP's "Sign in with Oxy" (QR) flow controller.
 *
 * The auth app is the Identity Provider, but for this handoff it is itself a
 * relying party: it SHOWS a QR, the user approves in their Oxy app (Commons)
 * on their phone (where the private key lives), and the IdP web page completes
 * its own login with the resulting `sessionId` — the SAME `completeLogin` path
 * the password flow uses.
 *
 * This is a thin React wrapper over the core device-flow primitives
 * (`startCommonsSignIn` → `pollCommonsSignIn`). It deliberately uses
 * `@oxyhq/core` directly rather than `@oxyhq/auth`'s `useCommonsSignIn`: the
 * IdP must stay free of the auth SDK's React-Query / zustand peer weight (it is
 * the IdP, not an RP shell), and its completion semantics differ — it finishes
 * via `completeLogin(sessionId)` (FedCM cookie + OAuth redirect), NOT by
 * committing a web session into a `WebOxyProvider`. There is therefore no
 * `claimSessionByToken`: the device-flow `sessionId` is handed straight to the
 * existing IdP login-completion path.
 *
 * Timers are managed imperatively from `start()` / `reset()` (an event-driven
 * subscription, not derived state); the only effects are an optional one-shot
 * auto-start and unmount cleanup.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import type { OxyServices, CommonsSignInStatus } from "@oxyhq/core"
import { renderQrDataUrl } from "@/lib/qr"

export type CommonsSignInPhase =
  | "idle"
  | "starting"
  | "waiting"
  | "authorized"
  | "denied"
  | "expired"
  | "error"

export interface UseCommonsSignInOptions {
  oxyServices: OxyServices
  /** The IdP's own registered OAuth client id (ApplicationCredential publicKey). */
  clientId: string
  /** Called once the approver authorizes — hand the `sessionId` to `completeLogin`. */
  onAuthorized: (sessionId: string) => void
  /** Status poll interval in ms (default 2500). */
  pollIntervalMs?: number
  /** Rendered QR image width in pixels (default 232). */
  qrWidth?: number
  /** Begin the flow automatically on mount (default false). */
  autoStart?: boolean
}

export interface UseCommonsSignInResult {
  phase: CommonsSignInPhase
  qrPayload: string | null
  qrImageDataUrl: string | null
  expiresAt: number | null
  error: string | null
  start: () => void
  reset: () => void
}

const DEFAULT_POLL_INTERVAL_MS = 2500

export function useCommonsSignIn({
  oxyServices,
  clientId,
  onAuthorized,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  qrWidth = 232,
  autoStart = false,
}: UseCommonsSignInOptions): UseCommonsSignInResult {
  const [phase, setPhase] = useState<CommonsSignInPhase>("idle")
  const [qrPayload, setQrPayload] = useState<string | null>(null)
  const [qrImageDataUrl, setQrImageDataUrl] = useState<string | null>(null)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Latest `onAuthorized` read via ref so the long-lived poll closure never
  // captures a stale callback.
  const onAuthorizedRef = useRef(onAuthorized)
  onAuthorizedRef.current = onAuthorized

  const runIdRef = useRef(0)
  const sessionTokenRef = useRef<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const stopTimers = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    if (expiryTimerRef.current) {
      clearTimeout(expiryTimerRef.current)
      expiryTimerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    runIdRef.current += 1
    stopTimers()
    sessionTokenRef.current = null
    setPhase("idle")
    setQrPayload(null)
    setQrImageDataUrl(null)
    setExpiresAt(null)
    setError(null)
  }, [stopTimers])

  const start = useCallback(() => {
    runIdRef.current += 1
    const runId = runIdRef.current
    stopTimers()
    sessionTokenRef.current = null
    setError(null)
    setQrPayload(null)
    setQrImageDataUrl(null)
    setExpiresAt(null)
    setPhase("starting")

    void (async () => {
      try {
        const handle = await oxyServices.startCommonsSignIn({ clientId })
        if (runId !== runIdRef.current || !mountedRef.current) return

        const dataUrl = await renderQrDataUrl(handle.qrPayload, qrWidth)
        if (runId !== runIdRef.current || !mountedRef.current) return

        sessionTokenRef.current = handle.sessionToken
        setQrPayload(handle.qrPayload)
        setQrImageDataUrl(dataUrl)
        setExpiresAt(handle.expiresAt)
        setPhase("waiting")

        const ttl = handle.expiresAt - Date.now()
        expiryTimerRef.current = setTimeout(() => {
          if (runId !== runIdRef.current || !mountedRef.current) return
          stopTimers()
          setPhase("expired")
        }, Math.max(ttl, 0))

        pollTimerRef.current = setInterval(() => {
          const token = sessionTokenRef.current
          if (!token) return

          void (async () => {
            let status: CommonsSignInStatus
            try {
              status = await oxyServices.pollCommonsSignIn(token)
            } catch {
              // Transient poll error — the next tick retries.
              return
            }
            if (runId !== runIdRef.current || !mountedRef.current) return

            if (status.authorized && status.sessionId) {
              stopTimers()
              setPhase("authorized")
              onAuthorizedRef.current(status.sessionId)
            } else if (status.status === "cancelled") {
              stopTimers()
              setPhase("denied")
            } else if (status.status === "expired") {
              stopTimers()
              setPhase("expired")
            }
          })()
        }, pollIntervalMs)
      } catch (err) {
        if (runId !== runIdRef.current || !mountedRef.current) return
        stopTimers()
        setError(err instanceof Error ? err.message : "Failed to start sign in.")
        setPhase("error")
      }
    })()
  }, [oxyServices, clientId, qrWidth, pollIntervalMs, stopTimers])

  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStart && !autoStartedRef.current) {
      autoStartedRef.current = true
      start()
    }
  }, [autoStart, start])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      runIdRef.current += 1
      stopTimers()
    }
  }, [stopTimers])

  return { phase, qrPayload, qrImageDataUrl, expiresAt, error, start, reset }
}
