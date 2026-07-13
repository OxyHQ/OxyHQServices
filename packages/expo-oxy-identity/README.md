# @oxyhq/expo-oxy-identity

Cross-app shared Oxy identity bridge — the native plumbing behind same-device
silent **"Sign in with Oxy"**.

The shared Oxy identity is a single secp256k1 keypair. **Commons** (the identity
vault) writes it once; every other Oxy app on the **same device**, signed with
the **same release key**, can silently read it and re-mint a server session from
it (`signInWithSharedIdentity` in the SDK cold boot). No prompt, no QR, no
opening Commons.

## Why a native module?

`expo-secure-store` is package-private on Android and `expo-file-system` can't
read a sibling package's path, so the only robust cross-app channel is a
signature-permission-protected `ContentProvider` hosted by Commons.

- **Write (Commons):** `putShared` persists the keypair into Commons's own
  hardware-backed `EncryptedSharedPreferences("oxy_shared_identity")`
  (`MasterKey` AES256_GCM).
- **Read (any same-key Oxy app):** `getShared` checks the LOCAL store first
  (Commons reading itself), then calls
  `content://so.oxy.commons.identity` (and the dev-variant authority
  `content://so.oxy.commons.dev.identity`) via `ContentResolver.call`.

The **trust boundary is the shared release signing key** (via a `signature`
protection-level permission `so.oxy.shared.permission.READ_IDENTITY`), not the
deprecated `sharedUserId`. The provider does a belt-and-suspenders caller
signature check on top of the manifest permission.

## Platforms

| Platform | Behavior |
|----------|----------|
| Android  | Full implementation (module + `ContentProvider`). |
| iOS      | Every function is a no-op → the Keychain Access Group (`group.so.oxy.shared`) path in `@oxyhq/core`'s `KeyManager` owns iOS sharing. |
| Web / unlinked | `requireOptionalNativeModule` returns `null` → all functions degrade to `null`/no-op. |

## Consumption

This module is **not called directly by app code**. `@oxyhq/core`'s `KeyManager`
Android branches route through `@oxyhq/protocol`'s `loadSharedIdentityBridge()`
(a Metro-hidden dynamic import), which resolves this module on native and `null`
everywhere else. Apps only need to:

1. Depend on `@oxyhq/expo-oxy-identity` (so autolinking materializes it).
2. **Commons** registers `withSharedIdentityProvider` (hosts the provider).
3. **Reader apps** register `withSharedIdentityReader` (requests the permission +
   provider `<queries>`).
4. Add the shared Keychain Access Group entitlement (iOS) — `ios.entitlements`
   in each app config.

## Verification

Kotlin/Swift correctness is verified on real hardware via EAS (two devices, same
signing key). The JS surface + build are validated in CI.
