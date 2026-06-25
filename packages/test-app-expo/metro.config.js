const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

// Find the project and package directories
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');
const coreRoot = path.resolve(projectRoot, '..', 'core');
const servicesRoot = path.resolve(projectRoot, '..', 'services');
const servicesSrc = path.resolve(servicesRoot, 'src');
const servicesNodeModules = path.resolve(servicesRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// Explicitly set projectRoot
config.projectRoot = projectRoot;

// 1. Watch the local services package (source + its node_modules)
// Explicitly include the src directory to ensure hot reload works
config.watchFolders = [
  coreRoot,
  servicesRoot,
  servicesSrc,
  servicesNodeModules,
  path.resolve(monorepoRoot, 'node_modules'),
];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
  servicesNodeModules,
];

// 3. Allow nested node_modules to resolve expo-router's web deps (e.g. Radix)
config.resolver.disableHierarchicalLookup = false;

// 4. Ensure source extensions include TypeScript files
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'ts',
  'tsx',
];

// 4a. Register `woff2`/`woff` as asset extensions so Metro can resolve the
// font files bundled by `@oxyhq/bloom`. Metro's default `assetExts` includes
// `ttf` and `otf` but not the web font formats; Bloom's web variant imports
// `.woff2` files, which Metro must treat as static assets when building
// `expo export --platform web` (otherwise the bundle fails with
// `Unable to resolve module ./assets/X.woff2`).
config.resolver.assetExts = [
  ...config.resolver.assetExts,
  'woff2',
  'woff',
  'wasm',
];

// 5. Extra module resolution for local packages
config.resolver.extraNodeModules = {
  '@oxyhq/core': path.resolve(coreRoot, 'src', 'index.ts'),
  '@oxyhq/services': path.resolve(servicesRoot, 'src', 'index.ts'),
  '@oxyhq/services/ui': path.resolve(servicesRoot, 'src', 'ui'),
};

// 6. Enable better platform resolution
config.resolver.platforms = ['native', 'android', 'ios', 'tsx', 'ts', 'web'];

// 7. Force `@oxyhq/bloom` to resolve to a SINGLE physical instance.
//
// In this monorepo the same Bloom version ends up duplicated under both
// `node_modules/@oxyhq/bloom` (hoisted) and `packages/test-app-expo/
// node_modules/@oxyhq/bloom` (local). When `@oxyhq/services` (which lives
// under root `node_modules`) imports `@oxyhq/bloom`, Node-style resolution
// would pick up the hoisted copy, while test-app-expo code resolves to its
// own local copy. Each copy creates its own React Context object — so
// `<BloomThemeProvider>` rendered by `OxyProvider` (services bloom) does NOT
// satisfy `useTheme()` called from app code (app bloom).
//
// We use a custom `resolveRequest` to rewrite the `originModulePath` of
// every `@oxyhq/bloom[/subpath]` import to test-app-expo' own package root,
// so Metro's default resolver picks up the package from the local install
// every time instead of finding the hoisted duplicate first.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === '@oxyhq/bloom' || moduleName.startsWith('@oxyhq/bloom/')) {
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

// 8. Ensure Fast Refresh is enabled (default in Expo, but explicit for clarity)
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return middleware;
  },
};

// 9. Optimize cache for better hot reload performance
config.cacheStores = config.cacheStores || [];

// 10. Wire NativeWind (Tailwind v4 token utilities → CSS at build/runtime).
// `input` points NativeWind at the CSS entry (./global.css); `inlineVariables: false`
// preserves CSS custom properties at runtime so BloomThemeProvider/applyFontFaces can
// override the token vars after first paint instead of NativeWind inlining them.
module.exports = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
  inlineVariables: false,
});
