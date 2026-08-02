/**
 * Expo Config Plugin: withSharedUserId
 *
 * Adds android:sharedUserId to AndroidManifest.xml to enable cross-app data
 * sharing between Oxy apps (Mention, Homiio, accounts, Commons, …).
 *
 * This allows:
 * - Shared cryptographic identity storage
 * - Cross-app authentication (sign in once, use everywhere)
 * - Shared session tokens
 *
 * IMPORTANT:
 * - All Oxy apps MUST use the same sharedUserId: "so.oxy.shared"
 * - Apps MUST be signed with the same certificate
 * - Cannot change sharedUserId after publishing (requires reinstall)
 *
 * @see https://developer.android.com/guide/topics/manifest/manifest-element#uid
 *
 * @param {import('expo/config').ExpoConfig} config
 * @param {string} [sharedUserId='so.oxy.shared'] The android:sharedUserId value.
 */
const { withAndroidManifest } = require('expo/config-plugins');

module.exports = function withSharedUserId(config, sharedUserId = 'so.oxy.shared') {
  return withAndroidManifest(config, async (config) => {
    const androidManifest = config.modResults.manifest;

    // Add sharedUserId to the manifest root element
    androidManifest.$ = {
      ...androidManifest.$,
      'android:sharedUserId': sharedUserId,
    };

    return config;
  });
};
