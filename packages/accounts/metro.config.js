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
  // NativeWind 5 / react-native-css compiles the Tailwind utility stylesheet
  // from the `global.css` that `app/_layout.tsx` imports — the actual trigger is
  // the code-level `import '../global.css'`, not this option (react-native-css
  // does not consume a metro `input`). It is kept for parity with the shared
  // @oxyhq/app-preset/metro factory. Without global.css wired in, react-native-css
  // still puts `className` tokens on the DOM but NO backing `.flex-row` /
  // `.bg-primary` / `.gap-*` rules exist, so every className layout utility used
  // by @oxyhq/services' screens is inert on web and react-native-web's base View
  // reset shows through (flex-direction:column, padding:0).
  input: './global.css',
  inlineRem: 16,
  inlineVariables: false,
});

const parentResolveRequest = nativeWindConfig.resolver.resolveRequest;

// Canonical Bloom package root for the single-instance rewrite below (invariant,
// so hoisted out of the per-resolution closure).
const BLOOM_ORIGIN = path.join(__dirname, 'package.json');

// Force `@oxyhq/bloom` to resolve to a SINGLE physical instance. In this monorepo
// the same Bloom version is duplicated under the hoisted root `node_modules` and
// each app's local `node_modules`; two copies mean two React Context objects, so
// `<BloomThemeProvider>` (rendered by services' Bloom) does not satisfy `useTheme()`
// called from app Bloom, crashing with "useTheme must be used within a
// <BloomThemeProvider>". Rewriting the import origin to accounts' own package root
// makes Metro's resolver pick the canonical install every time.
nativeWindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  // Shim Node-only `ws` for web builds (engine.io-client pulls it in).
  if (platform === 'web' && (moduleName === 'ws' || moduleName === 'node:ws')) {
    return { type: 'empty' };
  }

  const resolveContext =
    moduleName === '@oxyhq/bloom' || moduleName.startsWith('@oxyhq/bloom/')
      ? { ...context, originModulePath: BLOOM_ORIGIN }
      : context;

  // withNativeWind always installs a resolver, so `parentResolveRequest` is
  // guaranteed — always delegate to it (react-native-css requires being the parent).
  return parentResolveRequest(resolveContext, moduleName, platform);
};

module.exports = nativeWindConfig;
