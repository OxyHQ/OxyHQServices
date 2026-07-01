/**
 * Expo config-plugin entry point for `@oxyhq/expo-splash`.
 *
 * Expo resolves `"@oxyhq/expo-splash"` in an app's `plugins` array to this
 * `app.plugin.js` at the package root. It re-exports the branding config plugin
 * so an app adopts the shared Oxy bottom branding with a single entry:
 *
 *   plugins: ["@oxyhq/expo-splash"]           // defaults (bundled Oxy asset)
 *   plugins: [["@oxyhq/expo-splash", { imageWidth: 56 }]]  // with options
 *
 * MUST be listed AFTER the `expo-splash-screen` plugin (which generates the
 * Android splash theme + iOS LaunchScreen storyboard this plugin augments).
 */
module.exports = require('./plugin/withOxySplashBranding');
