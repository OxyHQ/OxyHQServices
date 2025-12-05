const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const fs = require('fs');

// Find the project and services directories
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');
const servicesRoot = path.resolve(projectRoot, '..', 'services');
const servicesSrc = path.resolve(servicesRoot, 'src');
const servicesNodeModules = path.resolve(servicesRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

// Explicitly set projectRoot
config.projectRoot = projectRoot;

// 1. Watch the local services package (source + its node_modules)
// Explicitly include the src directory to ensure hot reload works
// Only add directories that exist to avoid ENOENT errors
const watchFolders = [servicesRoot, servicesSrc];
if (fs.existsSync(servicesNodeModules)) {
  watchFolders.push(servicesNodeModules);
}
config.watchFolders = watchFolders;

// 2. Let Metro know where to resolve packages and in what order
const nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
if (fs.existsSync(servicesNodeModules)) {
  nodeModulesPaths.push(servicesNodeModules);
}
config.resolver.nodeModulesPaths = nodeModulesPaths;

// 3. Configure hierarchical lookup for proper dependency resolution
// Set to false to allow Metro to find dependencies in parent node_modules
config.resolver.disableHierarchicalLookup = false;

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
};

// 6. Enable better platform resolution
config.resolver.platforms = ['native', 'android', 'ios', 'tsx', 'ts', 'web'];

// 7. Ensure Fast Refresh is enabled (default in Expo, but explicit for clarity)
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => {
    return middleware;
  },
};

// 8. Optimize cache for better hot reload performance
config.cacheStores = config.cacheStores || [];

module.exports = config;