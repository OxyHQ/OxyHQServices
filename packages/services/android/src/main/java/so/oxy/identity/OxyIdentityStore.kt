package so.oxy.identity

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

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
 */
internal object OxyIdentityStore {
  const val PREFS_NAME = "oxy_shared_identity"
  const val KEY_PRIVATE = "priv"
  const val KEY_PUBLIC = "pub"

  @Volatile private var cachedPrefs: SharedPreferences? = null

  private fun prefs(context: Context): SharedPreferences {
    cachedPrefs?.let { return it }
    return synchronized(this) {
      cachedPrefs ?: run {
        val appContext = context.applicationContext
        val masterKey = MasterKey.Builder(appContext)
          .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
          .build()
        val created = EncryptedSharedPreferences.create(
          appContext,
          PREFS_NAME,
          masterKey,
          EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
          EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
        cachedPrefs = created
        created
      }
    }
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
