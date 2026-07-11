import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export type NfcEmitterState = 'unsupported' | 'off' | 'emitting';

interface UseNfcAttestEmitterOptions {
  /** The `oxycommons://attest?…` string (same bytes as the QR); null while loading. */
  payload: string | null;
  /** Arm only while the owning screen is focused. */
  enabled: boolean;
  /** Fired once per HCE read session — the counterparty pulled the payload. */
  onRead: () => void;
}

/**
 * Emits the attestation payload as an NDEF Type 4 tag via HCE while enabled
 * (Android only). `'off'` covers NFC-disabled AND not-armed; only `'emitting'`
 * drives UI. Arms/disarms with the effect lifecycle; the caller regenerates
 * the payload on read/expiry, which re-arms with fresh bytes.
 */
export function useNfcAttestEmitter({ payload, enabled, onRead }: UseNfcAttestEmitterOptions): {
  state: NfcEmitterState;
} {
  const [state, setState] = useState<NfcEmitterState>(
    Platform.OS === 'android' ? 'off' : 'unsupported',
  );
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    if (!enabled || !payload) {
      setState('off');
      return;
    }

    let cancelled = false;
    let removeListener: (() => void) | null = null;
    let armedSession: { setEnabled: (value: boolean) => Promise<unknown> } | null = null;

    (async () => {
      try {
        const NfcManager = (await import('react-native-nfc-manager')).default;
        const [supported, nfcOn] = await Promise.all([NfcManager.isSupported(), NfcManager.isEnabled()]);
        if (cancelled) return;
        if (!supported) {
          setState('unsupported');
          return;
        }
        if (!nfcOn) {
          setState('off');
          return;
        }

        const { HCESession, NFCTagType4, NFCTagType4NDEFContentType } = await import('react-native-hce');
        if (cancelled) return;
        const tag = new NFCTagType4({
          type: NFCTagType4NDEFContentType.URL,
          content: payload,
          writable: false,
        });
        const session = await HCESession.getInstance();
        // Register the disarm target BEFORE enabling — if the effect is
        // cancelled mid-arm, cleanup must still switch the service off.
        armedSession = session;
        await session.setApplication(tag);
        await session.setEnabled(true);
        if (cancelled) return;
        removeListener = session.on(HCESession.Events.HCE_STATE_READ, () => {
          onReadRef.current();
        });
        setState('emitting');
      } catch (error) {
        console.error('[useNfcAttestEmitter] failed to arm HCE session', error);
        if (!cancelled) setState('off');
      }
    })();

    return () => {
      cancelled = true;
      removeListener?.();
      if (armedSession) {
        armedSession.setEnabled(false).catch((error) => {
          console.warn('[useNfcAttestEmitter] failed to disarm HCE session', error);
        });
      }
    };
  }, [payload, enabled]);

  return { state };
}
