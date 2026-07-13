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
 */
internal object OxyIdentityStore {
  const val PREFS_NAME = "oxy_shared_identity"
  const val KEY_PRIVATE = "priv"
  const val KEY_PUBLIC = "pub"

  private fun prefs(context: Context): SharedPreferences {
    val masterKey = MasterKey.Builder(context)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()
    return EncryptedSharedPreferences.create(
      context,
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
    prefs(context).edit()
      .putString(KEY_PRIVATE, priv)
      .putString(KEY_PUBLIC, pub)
      .apply()
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }
}
