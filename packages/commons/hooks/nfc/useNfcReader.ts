import { useCallback, useEffect, useState } from 'react';

import NfcManager, { Ndef, NfcTech } from 'react-native-nfc-manager';

export type NfcReadResult = { ok: true; uri: string } | { ok: false; reason: 'cancelled' | 'empty' };

// `NfcManager.start()` registers a native tag-state broadcast receiver (Android) with no
// matching `stop()` — the package README calls it once, "before all next steps", from module
// scope. Calling it again on every `readOnce()` would re-register that receiver on every read.
// Memoize the promise so it only ever runs once per app lifetime, however many times this hook
// is mounted or `readOnce` is called.
let startPromise: Promise<void> | null = null;
function ensureStarted(): Promise<void> {
  if (!startPromise) {
    startPromise = NfcManager.start();
  }
  return startPromise;
}

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
    try {
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
      NfcManager.cancelTechnologyRequest().catch((error) => {
        console.warn('[useNfcReader] cancelTechnologyRequest failed', error);
      });
    }
  }, []);

  return { available, readOnce };
}
