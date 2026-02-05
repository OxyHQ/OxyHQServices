const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');
const coreRoot = path.resolve(monorepoRoot, 'packages', 'core');
const servicesRoot = path.resolve(monorepoRoot, 'packages', 'services');
const servicesSrc = path.resolve(servicesRoot, 'src');
const servicesNodeModules = path.resolve(servicesRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

config.projectRoot = projectRoot;

config.watchFolders = [
  projectRoot,
  coreRoot,
  servicesRoot,
  servicesSrc,
  servicesNodeModules,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
  servicesNodeModules,
];

config.resolver.disableHierarchicalLookup = true;

config.resolver.sourceExts = [
  ...config.resolver.sourceExts,
  'ts',
  'tsx',
];

// Resolve packages from root node_modules for monorepo compatibility
const rootNodeModules = path.resolve(monorepoRoot, 'node_modules');

config.resolver.extraNodeModules = {
  '@oxyhq/core': path.resolve(coreRoot, 'src', 'index.ts'),
  '@oxyhq/services': path.resolve(servicesRoot, 'src', 'index.ts'),
  '@oxyhq/services/ui': path.resolve(servicesRoot, 'src', 'ui'),
  // Explicitly resolve @expo/metro-runtime from root to avoid monorepo hoisting issues
  '@expo/metro-runtime': path.resolve(rootNodeModules, '@expo', 'metro-runtime'),
};

config.resolver.platforms = ['native', 'android', 'ios', 'tsx', 'ts', 'web'];

config.cacheStores = config.cacheStores || [];

module.exports = config;
