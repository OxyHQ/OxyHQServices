package so.oxy.identity

import android.content.Context
import android.net.Uri
import android.os.Bundle
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * JS bridge for the cross-app shared Oxy identity.
 *
 * - `putShared` persists the keypair into THIS app's own hardware-backed
 *   EncryptedSharedPreferences (only Commons calls this).
 * - `getShared` resolves the keypair from the LOCAL store first (Commons reading
 *   itself), then from the Commons ContentProvider — prod authority, then the
 *   dev-variant authority. The `signature` permission on the provider means only
 *   apps signed with the shared Oxy release key can resolve it.
 * - `hasShared` / `clearShared` are the check + local teardown helpers.
 *
 * Every failure resolves to null / no-op so the JS layer degrades to the app's
 * normal interactive sign-in path.
 */
class OxyIdentityModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OxyIdentity")

    AsyncFunction("getShared") {
      readShared()
    }

    AsyncFunction("putShared") { privateKey: String, publicKey: String ->
      OxyIdentityStore.write(context, privateKey, publicKey)
    }

    AsyncFunction("hasShared") {
      readShared() != null
    }

    AsyncFunction("clearShared") {
      OxyIdentityStore.clear(context)
    }
  }

  /**
   * Local EncryptedSharedPreferences first, then the Commons provider (prod
   * authority, then dev). Returns null on any failure.
   */
  private fun readShared(): Map<String, String>? {
    runCatching { OxyIdentityStore.read(context) }.getOrNull()?.let { (priv, pub) ->
      return mapOf("privateKey" to priv, "publicKey" to pub)
    }

    for (authority in PROVIDER_AUTHORITIES) {
      val result = runCatching { callProvider(authority) }.getOrNull()
      if (result != null) return result
    }
    return null
  }

  private fun callProvider(authority: String): Map<String, String>? {
    val uri = Uri.parse("content://$authority")
    val bundle: Bundle = context.contentResolver.call(uri, METHOD_GET_SHARED, null, null)
      ?: return null
    val priv = bundle.getString(OxyIdentityStore.KEY_PRIVATE) ?: return null
    val pub = bundle.getString(OxyIdentityStore.KEY_PUBLIC) ?: return null
    if (priv.isEmpty() || pub.isEmpty()) return null
    return mapOf("privateKey" to priv, "publicKey" to pub)
  }

  companion object {
    private const val METHOD_GET_SHARED = "getShared"

    // Commons hosts the provider at "${applicationId}.identity". Try the prod
    // app id first, then the dev variant ("so.oxy.commons.dev").
    private val PROVIDER_AUTHORITIES = listOf(
      "so.oxy.commons.identity",
      "so.oxy.commons.dev.identity"
    )
  }
}
