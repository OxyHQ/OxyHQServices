package so.oxy.identity

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Bundle

/**
 * Cross-process read surface for the shared Oxy identity, hosted ONLY by Commons
 * (declared per-app by the `withSharedIdentityProvider` config plugin with a
 * `signature`-level permission, authority `${applicationId}.identity`).
 *
 * `call("getShared")` returns the keypair from Commons's own
 * EncryptedSharedPreferences — but ONLY after verifying the caller is signed
 * with the SAME certificate. That signature check is belt-and-suspenders on top
 * of the manifest's `signature` permission: even if the permission gate were
 * ever misconfigured, a differently-signed caller still gets null.
 *
 * All standard CRUD operations are no-ops; this provider exists solely for the
 * `call()` channel.
 */
class OxyIdentityProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
    if (method != METHOD_GET_SHARED) return null
    val ctx = context ?: return null
    if (!callerSignatureMatches(ctx)) return null

    val pair = runCatching { OxyIdentityStore.read(ctx) }.getOrNull() ?: return null
    return Bundle().apply {
      putString(OxyIdentityStore.KEY_PRIVATE, pair.first)
      putString(OxyIdentityStore.KEY_PUBLIC, pair.second)
    }
  }

  /**
   * True when the calling package shares this app's signing certificate. Uses
   * `checkSignatures` (deprecated but still the simplest correct cross-package
   * signature comparison; returns SIGNATURE_MATCH only for same-cert apps).
   */
  private fun callerSignatureMatches(ctx: Context): Boolean {
    val caller = callingPackage ?: return false
    return runCatching {
      @Suppress("DEPRECATION")
      ctx.packageManager.checkSignatures(caller, ctx.packageName) == PackageManager.SIGNATURE_MATCH
    }.getOrDefault(false)
  }

  override fun query(
    uri: Uri,
    projection: Array<out String>?,
    selection: String?,
    selectionArgs: Array<out String>?,
    sortOrder: String?
  ): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(
    uri: Uri,
    values: ContentValues?,
    selection: String?,
    selectionArgs: Array<out String>?
  ): Int = 0

  companion object {
    private const val METHOD_GET_SHARED = "getShared"
  }
}
