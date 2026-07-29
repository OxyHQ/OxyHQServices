package so.oxy.session

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * JS side of the background session credential.
 *
 * JS is the only writer of the credential and native background code is the only
 * consumer, so this bridge is deliberately one-way: put, clear, and a read of the
 * account id (which JS needs to notice that the stored credential belongs to a
 * different account than the one now signed in). There is no `get` — JS has no
 * use for the secret it just wrote, and not exposing it keeps the secret's only
 * reader native.
 *
 * Every function is a no-op-or-null on failure rather than throwing: the app must
 * work identically whether or not background credentials are available, and a
 * keystore hiccup must never break sign-in.
 */
class OxyBackgroundSessionModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  /**
   * The provisioned credential as it crosses the bridge.
   *
   * `expiresAt` is epoch MILLIS, already parsed from the server's ISO-8601 string
   * on the JS side — JS has a `Date`, so there is no reason to hand native a
   * string to re-parse.
   */
  data class CredentialInput(
    @Field val baseUrl: String = "",
    @Field val deviceId: String = "",
    @Field val secret: String = "",
    @Field val accountId: String = "",
    @Field val expiresAt: Double = 0.0,
  ) : Record

  override fun definition() = ModuleDefinition {
    Name("OxyBackgroundSession")

    /**
     * Store (replacing) the credential. Rejects an incomplete or already-expired
     * one rather than persisting something no mint could ever use.
     */
    AsyncFunction("put") { credential: CredentialInput ->
      val expiresAt = credential.expiresAt.toLong()
      if (
        credential.baseUrl.isEmpty() ||
        credential.deviceId.isEmpty() ||
        credential.secret.isEmpty() ||
        credential.accountId.isEmpty() ||
        expiresAt <= System.currentTimeMillis()
      ) {
        return@AsyncFunction false
      }
      runCatching {
        OxyBackgroundSessionStore.writeCredential(
          context,
          OxyBackgroundSessionStore.Credential(
            baseUrl = credential.baseUrl,
            deviceId = credential.deviceId,
            secret = credential.secret,
            accountId = credential.accountId,
            expiresAt = expiresAt,
          ),
        )
      }.isSuccess
    }

    /**
     * Drop the credential and any cached token. Called on sign-out and BEFORE an
     * account switch, so the window in which background code could serve the
     * previous account's data is as short as a local write.
     */
    AsyncFunction("clear") {
      runCatching { OxyBackgroundSessionStore.clear(context) }.isSuccess
    }

    /**
     * What is currently stored — the account it belongs to and when it expires
     * (epoch millis) — or null when there is no usable credential.
     *
     * This is what lets JS decide whether to provision at all: a credential for
     * the signed-in account with plenty of life left needs no network call. It
     * deliberately does NOT return the secret; native is its only reader.
     */
    AsyncFunction("peek") {
      val stored = runCatching { OxyBackgroundSessionStore.readCredential(context) }.getOrNull()
        ?: return@AsyncFunction null
      mapOf(
        "accountId" to stored.accountId,
        "expiresAt" to stored.expiresAt.toDouble(),
      )
    }
  }
}
