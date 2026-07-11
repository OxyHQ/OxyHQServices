import { useCallback, useEffect, useState } from 'react';

import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';

export type NfcReadResult = { ok: true; uri: string } | { ok: false; reason: 'cancelled' | 'empty' };

// `NfcManager.start()` registers a native tag-state broadcast receiver (Android) with no
// matching `stop()` — the package README calls it once, "before all next steps", from module
// scope. Calling it again on every `readOnce()` would re-register that receiver on every read.
// Memoize the promise so a SUCCESSFUL start only ever runs once per app lifetime; a failed
// start clears the memo so the next read retries instead of replaying the cached rejection.
let startPromise: Promise<void> | null = null;
function ensureStarted(): Promise<void> {
  if (!startPromise) {
    startPromise = NfcManager.start().catch((error: unknown) => {
      startPromise = null;
      throw error;
    });
  }
  return startPromise;
}

// The NFC radio is a singleton and Android's `cancelTechnologyRequest` keeps teardown state
// in flight (~1s) after it resolves the JS call. `busy` makes `readOnce` reentrancy-safe — a
// double-tap resolves 'cancelled' without touching the radio; `pendingRelease` makes a new
// session wait for the previous teardown to finish before requesting the technology again.
let busy = false;
let pendingRelease: Promise<void> | null = null;

/**
 * One-shot NDEF reader for the "hold near the other phone" action (iPhone, and
 * Android as an in-app alternative to the system tap). `available` gates the
 * button; `readOnce` opens a reader session, decodes the first URI record, and
 * ALWAYS releases the NFC technology.
 */
export function useNfcReader(): { available: boolean; readOnce: () => Promise<NfcReadResult> } {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    NfcManager.isSupported()
      .then((supported) => {
        if (!cancelled) setAvailable(supported);
      })
      .catch((error) => {
        console.warn('[useNfcReader] isSupported failed', error);
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const readOnce = useCallback(async (): Promise<NfcReadResult> => {
    // Reentrancy guard: a read is already in flight — resolve without touching the radio.
    if (busy) return { ok: false, reason: 'cancelled' };
    busy = true;
    try {
      // Never open a new session before the previous teardown has finished.
      if (pendingRelease) await pendingRelease;
      await ensureStarted();
      await NfcManager.requestTechnology(NfcTech.Ndef);
      const tag = await NfcManager.getTag();
      const record = tag?.ndefMessage?.[0];
      if (!record?.payload?.length) return { ok: false, reason: 'empty' };
      const uri = Ndef.uri.decodePayload(Uint8Array.from(record.payload));
      if (!uri) return { ok: false, reason: 'empty' };
      return { ok: true, uri };
    } catch (error) {
      // Thrown on user dismissal of the OS sheet — expected, not an error state.
      console.warn('[useNfcReader] read session ended', error);
      return { ok: false, reason: 'cancelled' };
    } finally {
      // Fire-and-forget so the result resolves fast; the NEXT read awaits this instead.
      pendingRelease = NfcManager.cancelTechnologyRequest()
        .catch((error: unknown) => {
          console.warn('[useNfcReader] cancelTechnologyRequest failed', error);
        })
        .then(() => {
          pendingRelease = null;
        });
      busy = false;
    }
  }, []);

  return { available, readOnce };
}
