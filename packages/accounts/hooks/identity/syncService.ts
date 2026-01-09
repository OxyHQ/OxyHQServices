import { KeyManager, SignatureService } from '@oxyhq/services';
import { isInvalidSessionError } from '@oxyhq/services/ui';
import type { User, OxyServices } from '@oxyhq/services';
import { isAlreadyRegisteredError } from './errorUtils';

export interface SyncServiceOptions {
  /** OxyServices instance */
  oxyServices: OxyServices;
  /** Sign in function (with biometric support) */
  signIn: (publicKey: string) => Promise<User>;
  /** Whether identity is already synced (from caller's state management) */
  isAlreadySynced: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional callback when sync flag needs to be cleared (for expired session) */
  onSessionExpired?: () => Promise<void>;
}

export interface SyncServiceResult {
  /** The authenticated user */
  user: User;
  /** Whether identity was newly registered */
  wasRegistered: boolean;
}

const trySignInIfSynced = async (
  isAlreadySynced: boolean,
  signIn: (publicKey: string) => Promise<User>,
  publicKey: string,
  onSessionExpired?: () => Promise<void>
): Promise<User | null> => {
  if (!isAlreadySynced) return null;

  try {
    return await signIn(publicKey);
  } catch (signInError: unknown) {
    if (isInvalidSessionError(signInError)) {
      await onSessionExpired?.();
      return null;
    }
    throw signInError;
  }
};

const checkRegistrationStatus = async (
  oxyServices: OxyServices,
  publicKey: string,
  signal?: AbortSignal
): Promise<boolean> => {
  if (signal?.aborted) throw new Error('Sync aborted');

  try {
    const { registered } = await oxyServices.checkPublicKeyRegistered(publicKey);
    return registered;
  } catch (checkError: unknown) {
    if (__DEV__) {
      console.warn('[SyncService] Failed to check registration status:', checkError);
    }
    return false;
  }
};

const registerPublicKey = async (
  oxyServices: OxyServices,
  publicKey: string,
  signal?: AbortSignal
): Promise<boolean> => {
  if (signal?.aborted) throw new Error('Sync aborted');

  try {
    const { signature, timestamp } = await SignatureService.createRegistrationSignature();
    await oxyServices.register(publicKey, signature, timestamp);
    return true;
  } catch (error: unknown) {
    if (isAlreadyRegisteredError(error)) {
      return true;
    }
    throw error;
  }
};

export const syncIdentityWithServer = async (
  options: SyncServiceOptions
): Promise<SyncServiceResult> => {
  const { oxyServices, signIn, isAlreadySynced, signal, onSessionExpired } = options;

  const publicKey = await KeyManager.getPublicKey();
  if (!publicKey) throw new Error('No identity found on this device');
  if (signal?.aborted) throw new Error('Sync aborted');

  const signedInUser = await trySignInIfSynced(isAlreadySynced, signIn, publicKey, onSessionExpired);
  if (signedInUser) {
    return { user: signedInUser, wasRegistered: false };
  }

  const isRegistered = await checkRegistrationStatus(oxyServices, publicKey, signal);
  const wasRegistered = !isRegistered ? await registerPublicKey(oxyServices, publicKey, signal) : false;

  const user = await signIn(publicKey);
  return { user, wasRegistered };
};
