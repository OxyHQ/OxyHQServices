// Shared Oxy Metro config (monorepo watch folders, block list, symlink +
// package-exports resolution, web-font/wasm asset exts, minifier, NativeWind).
// See @oxyhq/app-preset/metro.
const { createOxyMetroConfig } = require('@oxyhq/app-preset/metro');

module.exports = createOxyMetroConfig(__dirname, {
  sharedTypesPackage: '@{{APP_SLUG}}/shared-types',
});
