const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');
const coreRoot = path.resolve(monorepoRoot, 'packages', 'core');
const servicesRoot = path.resolve(monorepoRoot, 'packages', 'services');
const servicesNodeModules = path.resolve(servicesRoot, 'node_modules');

const config = getDefaultConfig(projectRoot);

config.projectRoot = projectRoot;

config.watchFolders = [
  projectRoot,
  coreRoot,
  servicesRoot,
  servicesNodeModules,
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
  servicesNodeModules,
];

config.resolver.disableHierarchicalLookup = true;

config.resolver.extraNodeModules = {
  '@oxyhq/core': path.resolve(coreRoot, 'src', 'index.ts'),
  '@oxyhq/services': path.resolve(servicesRoot, 'src', 'index.ts'),
  '@oxyhq/services/ui': path.resolve(servicesRoot, 'src', 'ui'),
};

module.exports = config;
