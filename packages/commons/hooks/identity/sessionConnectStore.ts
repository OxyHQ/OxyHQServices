import { create } from 'zustand';

/**
 * Phase of the vault's automatic session connect (local identity → live session).
 *
 *   'idle'       — not connecting: a session is up, or the preconditions are not
 *                  met (still cold-booting, no local identity, or offline).
 *   'connecting' — an attempt is pending / in-flight.
 *   'error'      — the last attempt failed; the auto-connector is backing off
 *                  before its next retry (a manual retry can jump the queue).
 *
 * Commons IS the identity — it must never ask its owner to "sign in". When a
 * returning user reaches the vault with a local identity but no live session
 * (the local-first router lands them there while the device-first cold boot is
 * still minting, or has failed to mint while offline), the app connects the
 * session from the device's OWN primary key automatically. `useSessionAutoConnect`
 * (mounted once at app boot) drives that and publishes its phase here so the
 * `SessionGate` — mounted separately inside each vault screen — can render the
 * matching "connecting" / "couldn't connect" state and offer a manual retry,
 * without prop-drilling across the tab tree.
 */
export type SessionConnectPhase = 'idle' | 'connecting' | 'error';

interface SessionConnectStore {
  phase: SessionConnectPhase;
  /**
   * Bumped by {@link requestRetry} to ask the auto-connector for an immediate
   * attempt that bypasses the backoff schedule. `useSessionAutoConnect` keys its
   * driver effect on this value.
   */
  retryNonce: number;
  setPhase: (phase: SessionConnectPhase) => void;
  /** Request an immediate connect attempt (the SessionGate's Retry action). */
  requestRetry: () => void;
  /** Reset to the initial idle state (used by tests). */
  reset: () => void;
}

export const useSessionConnectStore = create<SessionConnectStore>((set) => ({
  phase: 'idle',
  retryNonce: 0,
  setPhase: (phase) => set({ phase }),
  requestRetry: () => set((state) => ({ retryNonce: state.retryNonce + 1, phase: 'connecting' })),
  reset: () => set({ phase: 'idle', retryNonce: 0 }),
}));
