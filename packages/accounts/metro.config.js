const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Register `woff2`/`woff` as asset extensions so Metro can resolve the font
// files bundled by `@oxyhq/bloom`. Metro's default `assetExts` includes `ttf`
// and `otf` but not the web font formats; Bloom's web variant imports
// `.woff2` files, which Metro must treat as static assets when building
// `expo export --platform web` (otherwise the bundle fails with
// `Unable to resolve module ./assets/X.woff2`).
config.resolver.assetExts = [
  ...config.resolver.assetExts,
  'woff2',
  'woff',
];

// Force `@oxyhq/bloom` to resolve to a SINGLE physical instance.
//
// In this monorepo the same Bloom version ends up duplicated under both
// `node_modules/@oxyhq/bloom` (hoisted) and `packages/accounts/node_modules/
// @oxyhq/bloom` (local). When `@oxyhq/services` (which lives under root
// `node_modules`) imports `@oxyhq/bloom`, Node-style resolution would pick up
// the hoisted copy, while accounts code resolves to its own local copy. Each
// copy creates its own React Context object — so `<BloomThemeProvider>`
// rendered by `OxyProvider` (services bloom) does NOT satisfy `useTheme()`
// called from accounts code (accounts bloom), and the splash screen crashes
// with "useTheme must be used within a <BloomThemeProvider>".
//
// We use a custom `resolveRequest` to rewrite the `originModulePath` of
// every `@oxyhq/bloom[/subpath]` import to accounts' own package root, so
// Metro's default resolver picks up the package from accounts' node_modules
// every time instead of finding the hoisted duplicate first.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Shim Node.js-only modules for web builds (engine.io-client pulls in ws)
  if (platform === 'web' && (moduleName === 'ws' || moduleName === 'node:ws')) {
    return { type: 'empty' };
  }

  if (moduleName === '@oxyhq/bloom' || moduleName.startsWith('@oxyhq/bloom/')) {
    // Pretend the import originated from accounts' own root, so Metro applies
    // the package's `react-native` field / exports map from the canonical
    // install (instead of finding the hoisted duplicate first).
    const rewrittenContext = {
      ...context,
      originModulePath: path.join(__dirname, 'package.json'),
    };
    if (originalResolveRequest) {
      return originalResolveRequest(rewrittenContext, moduleName, platform);
    }
    return context.resolveRequest(rewrittenContext, moduleName, platform);
  }

  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
