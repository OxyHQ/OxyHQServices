package so.oxy.identity

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.io.IOException
import java.security.GeneralSecurityException
import java.security.KeyStore

/**
 * Shared accessor for the hardware-backed EncryptedSharedPreferences that holds
 * the cross-app Oxy identity keypair.
 *
 * Used by BOTH [OxyIdentityModule] (the JS bridge / local read + write) and
 * [OxyIdentityProvider] (the cross-process read surface) so the store name and
 * the AES256 encryption scheme can never drift between the two halves.
 *
 * ## Single memoized instance (CRITICAL)
 *
 * `EncryptedSharedPreferences.create()` must be called AT MOST ONCE per file per
 * process. It is NOT safe to re-instantiate: when a second instance is created
 * for the same file while another is live (e.g. the JS write thread and a Binder
 * thread serving [OxyIdentityProvider.call] concurrently), Tink's keyset load
 * races and the next decrypt throws `AEADBadTagException` — which silently turned
 * every cross-app read into "no shared identity". So the instance is created once,
 * lazily, under a lock, keyed on the process-global application context, and
 * reused for all reads/writes/provider calls.
 *
 * ## Keyset self-heal (CRITICAL)
 *
 * The androidx master key that wraps this file's Tink keyset lives under the
 * UID-scoped default alias [MasterKey.DEFAULT_MASTER_KEY_ALIAS] — one entry for
 * the whole `so.oxy.shared` UID. When a NEW package joins that shared UID, that
 * master key can be rotated/regenerated, leaving the keyset already written into
 * `oxy_shared_identity.xml` wrapped under the OLD key. `create()` then fails GCM
 * verification (`AEADBadTag` -> `GeneralSecurityException`, or an unreadable
 * keyset -> `IOException`) on EVERY read/write, and `EncryptedSharedPreferences`
 * never self-heals — the slot stays permanently dead and cross-app "Sign in with
 * Oxy" silently falls back to interactive import.
 *
 * [openOrHealPrefs] recovers ONCE, in two bounded stages (no retry loop):
 *   1. Delete ONLY this slot's prefs file (the stale wrapped keyset) and rebuild
 *      against the current master key — heals the common rotation case without
 *      touching the master key, so other shared-UID members keep their keysets.
 *   2. If a fresh keyset STILL can't be built, the master key itself is unusable:
 *      delete its keystore alias so a new one is generated, wipe the file again,
 *      and rebuild. If that final rebuild throws, the exception propagates and the
 *      existing `runCatching {}` at every call site degrades to null.
 *
 * This NEVER touches the primary self-custody identity: that lives in
 * expo-secure-store under a DISTINCT prefs file ("SecureStore") and DISTINCT
 * keystore aliases ("key_v1"/extended), not the androidx master key wiped here.
 * The shared slot is a derived copy that Commons re-populates from the primary on
 * the next boot (`migrateToSharedIdentity`), so wiping it is non-destructive.
 */
internal object OxyIdentityStore {
  const val PREFS_NAME = "oxy_shared_identity"
  const val KEY_PRIVATE = "priv"
  const val KEY_PUBLIC = "pub"

  private const val TAG = "OxyIdentityStore"
  private const val ANDROID_KEYSTORE = "AndroidKeyStore"

  @Volatile private var cachedPrefs: SharedPreferences? = null

  private fun prefs(context: Context): SharedPreferences {
    cachedPrefs?.let { return it }
    return synchronized(this) {
      cachedPrefs ?: openOrHealPrefs(context.applicationContext).also { cachedPrefs = it }
    }
  }

  /**
   * Opens the EncryptedSharedPreferences, self-healing a corrupted/unreadable
   * keyset once (see the "Keyset self-heal" note above). Both exception types the
   * androidx `create()` declares — `GeneralSecurityException` (AEAD/GCM tag
   * mismatch) and `IOException` (unparseable keyset) — route into recovery.
   */
  private fun openOrHealPrefs(appContext: Context): SharedPreferences {
    return try {
      buildEncryptedPrefs(appContext)
    } catch (corrupt: GeneralSecurityException) {
      healCorruptedKeyset(appContext, corrupt)
    } catch (corrupt: IOException) {
      healCorruptedKeyset(appContext, corrupt)
    }
  }

  /**
   * Stage 1: wipe ONLY this slot's prefs file (which holds the stale wrapped
   * keyset) and rebuild against the current master key. Escalates to stage 2 if a
   * fresh keyset still can't be built.
   */
  private fun healCorruptedKeyset(appContext: Context, cause: Exception): SharedPreferences {
    Log.w(
      TAG,
      "shared-identity keyset unreadable (rotated master key); cleared and regenerated: ${cause.message}",
      cause
    )
    appContext.deleteSharedPreferences(PREFS_NAME)
    return try {
      buildEncryptedPrefs(appContext)
    } catch (stillCorrupt: GeneralSecurityException) {
      regenerateMasterKeyAndRebuild(appContext, stillCorrupt)
    } catch (stillCorrupt: IOException) {
      regenerateMasterKeyAndRebuild(appContext, stillCorrupt)
    }
  }

  /**
   * Stage 2 (belt-and-suspenders): the androidx master key itself is unusable, so
   * delete its keystore alias to force a fresh one, wipe the now-stale file again,
   * and rebuild. The alias is used ONLY by androidx EncryptedSharedPreferences —
   * expo-secure-store (the primary identity) uses its own distinct aliases — so
   * this never touches the self-custody key. A throw here propagates to the
   * call-site `runCatching {}`, which degrades to null.
   */
  private fun regenerateMasterKeyAndRebuild(appContext: Context, cause: Exception): SharedPreferences {
    Log.w(
      TAG,
      "shared-identity keyset still unreadable after prefs reset; deleting master key " +
        "'${MasterKey.DEFAULT_MASTER_KEY_ALIAS}' and regenerating: ${cause.message}",
      cause
    )
    KeyStore.getInstance(ANDROID_KEYSTORE).apply {
      load(null)
      if (containsAlias(MasterKey.DEFAULT_MASTER_KEY_ALIAS)) {
        deleteEntry(MasterKey.DEFAULT_MASTER_KEY_ALIAS)
      }
    }
    appContext.deleteSharedPreferences(PREFS_NAME)
    return buildEncryptedPrefs(appContext)
  }

  private fun buildEncryptedPrefs(appContext: Context): SharedPreferences {
    val masterKey = MasterKey.Builder(appContext)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()
    return EncryptedSharedPreferences.create(
      appContext,
      PREFS_NAME,
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
  }

  /** Read the stored keypair as (privateKey, publicKey), or null when absent/blank. */
  fun read(context: Context): Pair<String, String>? {
    val p = prefs(context)
    val priv = p.getString(KEY_PRIVATE, null) ?: return null
    val pub = p.getString(KEY_PUBLIC, null) ?: return null
    if (priv.isEmpty() || pub.isEmpty()) return null
    return priv to pub
  }

  fun write(context: Context, priv: String, pub: String) {
    // commit() (synchronous) so a cross-process reader that fires immediately
    // after the write is guaranteed to see the flushed value.
    prefs(context).edit()
      .putString(KEY_PRIVATE, priv)
      .putString(KEY_PUBLIC, pub)
      .commit()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().commit()
  }
}
