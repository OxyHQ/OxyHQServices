const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project and services directories
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');
const servicesRoot = path.resolve(monorepoRoot, 'packages', 'services');
const servicesSrc = path.resolve(servicesRoot, 'src');
const servicesNodeModules = path.resolve(servicesRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// Explicitly set projectRoot
config.projectRoot = projectRoot;

// 1. Watch the local services package (source + its node_modules)
// Explicitly include the src directory to ensure hot reload works
config.watchFolders = [
  projectRoot,
  servicesRoot,
  servicesSrc,
  servicesNodeModules,
];

// 2. Let Metro know where to resolve packages and in what order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
  servicesNodeModules,
];

// 3. Force Metro to resolve (sub)dependencies in the workspace
config.resolver.disableHierarchicalLookup = true;

// 3.5 Enable package exports support to properly resolve @noble/hashes subpaths
config.resolver.unstable_enablePackageExports = true;

// 4. Ensure source extensions include TypeScript files
config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'ts',
  'tsx',
];

// 5. Extra module resolution for local packages
config.resolver.extraNodeModules = {
  '@oxyhq/services': path.resolve(servicesRoot, 'src', 'index.ts'),
  '@oxyhq/services/core': path.resolve(servicesRoot, 'src', 'core'),
  '@oxyhq/services/full': path.resolve(servicesRoot, 'src', 'index.ts'),
  '@oxyhq/services/ui': path.resolve(servicesRoot, 'src', 'ui'),
  // Fix @noble/hashes exports warning - map .js imports to the correct paths
  '@noble/hashes/crypto.js': path.resolve(monorepoRoot, 'node_modules', '@noble/hashes', 'crypto.js'),
};

// 6. Enable better platform resolution
config.resolver.platforms = ['native', 'android', 'ios', 'tsx', 'ts', 'web'];

// 7. Optimize cache for better hot reload performance
config.cacheStores = config.cacheStores || [];

module.exports = config;




