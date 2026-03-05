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

// Watch only the specific workspace packages needed, not the entire monorepo
config.watchFolders = [
  projectRoot,
  coreRoot,
  servicesRoot,
  servicesSrc,
  servicesNodeModules,
];

// Explicit module resolution order
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
  servicesNodeModules,
];

// Force deterministic resolution (avoids scanning full node_modules tree)
config.resolver.disableHierarchicalLookup = true;

// Resolve @oxyhq/* packages to their source for development
config.resolver.extraNodeModules = {
  '@oxyhq/core': path.resolve(coreRoot, 'src', 'index.ts'),
  '@oxyhq/services': path.resolve(servicesRoot, 'src', 'index.ts'),
  '@oxyhq/services/ui': path.resolve(servicesRoot, 'src', 'ui'),
};

module.exports = config;
