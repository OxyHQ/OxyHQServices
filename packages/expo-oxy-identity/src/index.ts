/**
 * `@oxyhq/expo-oxy-identity` — cross-app shared Oxy identity bridge (native).
 *
 * The shared Oxy identity (a single secp256k1 keypair) is the trust root for
 * same-device "Sign in with Oxy": Commons (the identity vault) writes the
 * keypair once, and every other Oxy app on the SAME device — signed with the
 * SAME release key — can silently read it and re-mint a server session from it
 * (`signInWithSharedIdentity` in the SDK cold boot).
 *
 * ## Why a native module?
 *
 * `expo-secure-store` is package-private on Android (its keystore alias and
 * `SharedPreferences` file live inside the writer app's sandbox), and
 * `expo-file-system` cannot reliably read a sibling package's path. The only
 * robust cross-app channel is a signature-permission-protected `ContentProvider`
 * hosted by Commons. This module wraps both sides:
 *
 *  - **Write path (Commons):** `putShared` persists the keypair into Commons's
 *    own hardware-backed `EncryptedSharedPreferences("oxy_shared_identity")`.
 *  - **Read path (any same-key Oxy app):** `getShared` first checks the LOCAL
 *    store (Commons reading itself), then falls through to
 *    `content://so.oxy.commons.identity` (and the dev-variant authority
 *    `content://so.oxy.commons.dev.identity`) via `ContentResolver.call`. The
 *    `signature` protection level means only apps signed with the shared Oxy
 *    release key can resolve the provider — the trust boundary is the signing
 *    key, not the deprecated `sharedUserId`.
 *
 * ## Platforms
 *
 * Android carries the real implementation. iOS resolves every function to a
 * `null`/no-op because the Apple path keeps using the existing Keychain Access
 * Group (`group.so.oxy.shared`) directly inside `@oxyhq/core`'s `KeyManager`.
 * Web / any host without the linked native module degrades to `null`/no-op via
 * `requireOptionalNativeModule`.
 *
 * This module is loaded lazily and defensively by `@oxyhq/protocol`'s
 * `loadSharedIdentityBridge()` (a Metro-hidden dynamic import), so it never
 * enters a web/Node bundle and its absence is never fatal.
 */
import { requireOptionalNativeModule } from 'expo-modules-core';

/** A shared Oxy identity keypair (hex-encoded secp256k1). */
export interface SharedIdentity {
  privateKey: string;
  publicKey: string;
}

/**
 * The native module surface. Android implements it; iOS resolves everything to
 * `null`/no-op. The whole module is `null` on web or when it is not linked.
 */
interface OxyIdentityNativeModule {
  getShared(): Promise<SharedIdentity | null>;
  putShared(privateKey: string, publicKey: string): Promise<void>;
  hasShared(): Promise<boolean>;
  clearShared(): Promise<void>;
}

// `requireOptionalNativeModule` returns `null` (never throws) when the native
// module is not present in this runtime — web, or an app that did not autolink
// it. Every exported function guards on `native` so the JS surface is safe to
// call unconditionally.
const native = requireOptionalNativeModule<OxyIdentityNativeModule>('OxyIdentity');

/**
 * Read the shared Oxy identity keypair, or `null` when none is available on
 * this device (no Commons identity, provider denied by signature mismatch, or
 * the native module is not linked). Never throws — read failures degrade to
 * `null` so the caller falls back to its normal sign-in path.
 */
export async function getShared(): Promise<SharedIdentity | null> {
  if (!native) {
    return null;
  }
  try {
    const result = await native.getShared();
    if (
      result &&
      typeof result.privateKey === 'string' &&
      typeof result.publicKey === 'string' &&
      result.privateKey.length > 0 &&
      result.publicKey.length > 0
    ) {
      return { privateKey: result.privateKey, publicKey: result.publicKey };
    }
    return null;
  } catch {
    // A cross-process read that fails (provider absent, permission denied,
    // keystore locked) is a benign "no shared identity here" signal — the
    // caller falls back to interactive sign-in.
    return null;
  }
}

/**
 * Persist the shared Oxy identity keypair into THIS app's hardware-backed
 * store. Only Commons (the identity vault) calls this. Write failures
 * propagate so the caller (`KeyManager.createSharedIdentity` /
 * `importSharedIdentity`) can surface a genuine storage error rather than
 * silently believing the identity was shared.
 */
export async function putShared(privateKey: string, publicKey: string): Promise<void> {
  if (!native) {
    return;
  }
  await native.putShared(privateKey, publicKey);
}

/**
 * Whether a shared Oxy identity is readable on this device. Never throws.
 */
export async function hasShared(): Promise<boolean> {
  if (!native) {
    return false;
  }
  try {
    return await native.hasShared();
  } catch {
    return false;
  }
}

/**
 * Remove the shared Oxy identity from THIS app's local store. Best-effort:
 * failures are non-fatal (the caller is tearing down local state anyway).
 */
export async function clearShared(): Promise<void> {
  if (!native) {
    return;
  }
  try {
    await native.clearShared();
  } catch {
    // Best-effort teardown: a failed clear must not abort the surrounding
    // sign-out / purge flow.
  }
}
