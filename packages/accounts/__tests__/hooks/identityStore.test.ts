/**
 * Tests for the identity store, focused on the recovery-phrase
 * acknowledgement flag.
 *
 * The flag drives the high-priority "back up your recovery phrase"
 * security recommendation. If it's incorrectly defaulted to `true` or
 * persisted incorrectly, the user will not be reminded to save their
 * phrase — which is the single most common cause of irrecoverable
 * account loss in self-custody systems.
 */

import {
  useIdentityStore,
  persistRecoveryPhraseAcknowledged,
  getRecoveryPhraseAcknowledgedFromStorage,
  RECOVERY_PHRASE_ACK_STORAGE_KEY,
} from '@/hooks/identity/identityStore';
import { __resetSecureStore, __seedSecureStore } from '@/__mocks__/expo-secure-store';

describe('identityStore — recovery phrase acknowledgement', () => {
  beforeEach(() => {
    __resetSecureStore();
    // Reset zustand store between tests
    useIdentityStore.getState().reset();
  });

  it('defaults to NOT acknowledged on fresh launch (security-critical default)', () => {
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(false);
  });

  it('persists the acknowledgement flag through setRecoveryPhraseAcknowledged()', async () => {
    useIdentityStore.getState().setRecoveryPhraseAcknowledged(true);
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(true);

    // The persistence is fire-and-forget, so give the microtask queue a tick
    await Promise.resolve();
    await Promise.resolve();

    expect(await getRecoveryPhraseAcknowledgedFromStorage()).toBe(true);
  });

  it('hydrate() reads "true" from secure storage', async () => {
    __seedSecureStore(RECOVERY_PHRASE_ACK_STORAGE_KEY, 'true');
    await useIdentityStore.getState().hydrate();
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(true);
  });

  it('hydrate() defaults to false when no value is stored', async () => {
    await useIdentityStore.getState().hydrate();
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(false);
  });

  it('hydrate() rejects ambiguous values — only literal "true" is acknowledged', async () => {
    // Tampering or partial writes must not pretend to be acknowledged.
    __seedSecureStore(RECOVERY_PHRASE_ACK_STORAGE_KEY, '1');
    await useIdentityStore.getState().hydrate();
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(false);

    __seedSecureStore(RECOVERY_PHRASE_ACK_STORAGE_KEY, 'yes');
    await useIdentityStore.getState().hydrate();
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(false);
  });

  it('persistRecoveryPhraseAcknowledged() round-trips', async () => {
    await persistRecoveryPhraseAcknowledged(true);
    expect(await getRecoveryPhraseAcknowledgedFromStorage()).toBe(true);
    await persistRecoveryPhraseAcknowledged(false);
    expect(await getRecoveryPhraseAcknowledgedFromStorage()).toBe(false);
  });

  it('reset() restores the acknowledgement flag to its safe default', () => {
    useIdentityStore.getState().setRecoveryPhraseAcknowledged(true);
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(true);
    useIdentityStore.getState().reset();
    expect(useIdentityStore.getState().recoveryPhraseAcknowledged).toBe(false);
  });
});
