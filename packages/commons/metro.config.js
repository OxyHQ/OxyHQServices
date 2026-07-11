const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Register `woff2`/`woff` as asset extensions so Metro can resolve the font
// files bundled by `@oxyhq/bloom`. Metro's default `assetExts` includes `ttf`
// and `otf` but not the web font formats.
config.resolver.assetExts = [...config.resolver.assetExts, 'woff2', 'woff'];

// Apply NativeWind (react-native-css) FIRST so its Metro resolver/transformer is
// installed, THEN layer the Bloom single-instance rewrite on top. react-native-css
// requires that a custom `resolveRequest` delegate to its resolver (the "parent"),
// otherwise it throws a setup error at runtime; capturing NativeWind's resolver as
// `parentResolveRequest` and always calling through it satisfies that contract.
const nativeWindConfig = withNativeWind(config, {
  inlineRem: 16,
  inlineVariables: false,
});

const parentResolveRequest = nativeWindConfig.resolver.resolveRequest;

// Force `@oxyhq/bloom` to resolve to a SINGLE physical instance. In this monorepo
// the same Bloom version is duplicated under the hoisted root `node_modules` and
// each app's local `node_modules`; two copies mean two React Context objects, so
// `<BloomThemeProvider>` (rendered by services' Bloom) does not satisfy `useTheme()`
// called from app Bloom, crashing with "useTheme must be used within a
// <BloomThemeProvider>". Rewriting the import origin to commons' own package root
// makes Metro's resolver pick the canonical install every time.
nativeWindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  // Shim Node-only `ws` for web builds (engine.io-client pulls it in).
  if (platform === 'web' && (moduleName === 'ws' || moduleName === 'node:ws')) {
    return { type: 'empty' };
  }

  const resolveContext =
    moduleName === '@oxyhq/bloom' || moduleName.startsWith('@oxyhq/bloom/')
      ? { ...context, originModulePath: path.join(__dirname, 'package.json') }
      : context;

  return parentResolveRequest
    ? parentResolveRequest(resolveContext, moduleName, platform)
    : resolveContext.resolveRequest(resolveContext, moduleName, platform);
};

module.exports = nativeWindConfig;
