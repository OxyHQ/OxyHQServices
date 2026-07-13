/**
 * @oxyhq/protocol — the app-agnostic Oxy Protocol base.
 *
 * The reusable substrate any Oxy app can use to decentralize its own content:
 * the signed-record envelope grammar (canonical JSON, signing input, content
 * address), explicit-key signing/verification, and the platform-aware crypto
 * loaders. App-specific lexicons and the chain engine layer on top of this.
 *
 * Platform-agnostic root entry. Node-only pieces live under the `./node`
 * subpath so they never enter React Native / web bundles.
 */

// ---------------------------------------------------------------------------
// Envelope — canonical JSON, signing input, content address, signing/verify
// ---------------------------------------------------------------------------
export { canonicalize } from './envelope/canonicalJson';
export { signedRecordSigningInput } from './envelope/signingInput';
export type { SignedRecordSigningFields } from './envelope/signingInput';
export { sha256, computeRecordId } from './envelope/recordId';
export {
  signMessage,
  verifySignature,
  signEnvelope,
  verifyEnvelopeSignature,
} from './envelope/sign';

// ---------------------------------------------------------------------------
// Chain — per-subject hash-chain engine over an injected RecordStore + resolver
// ---------------------------------------------------------------------------
export type {
  ChainHead,
  RejectionReason,
  VerifyOutcome,
  AppendOutcome,
} from './chain/types';
export { UNCHAINED_SEQ } from './chain/types';
export { checkContinuity } from './chain/continuity';
export type { RecordStore, BlobStore } from './chain/recordStore';
export { verifyEnvelope, DEFAULT_CLOCK_SKEW_MS } from './chain/verify';
export type { VerifyOptions } from './chain/verify';
export { verifyAndAppend } from './chain/engine';

// ---------------------------------------------------------------------------
// Identity — injected verification-method resolution + authorization rule
// ---------------------------------------------------------------------------
export { isAuthorizedKey } from './identity/resolver';
export type {
  VerificationMethodResolver,
  ResolvedVerificationMethods,
  KeyAuthorization,
} from './identity/resolver';

// ---------------------------------------------------------------------------
// Platform — runtime predicates + lazy crypto/storage loaders
// ---------------------------------------------------------------------------
export { isReactNative, isNodeJS } from './platform/platform';
export {
  loadNodeCrypto,
  loadExpoCrypto,
  loadSecureStore,
  loadAsyncStorage,
  getRandomBytesRN,
  loadSharedIdentityBridge,
} from './platform/crypto';

// ---------------------------------------------------------------------------
// Platform types — structural interfaces for Expo modules.
//
// Exported so @oxyhq/core and other consumers can type their own wrappers
// without importing `typeof import('expo-crypto')` / `typeof import('expo-secure-store')`
// (which would trigger NodeNext type pollution in server packages).
// ---------------------------------------------------------------------------
export type { ExpoCryptoLike, ExpoSecureStoreLike, SharedIdentityBridge } from './platform/expoTypes';
