const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

// Find the project root (Accounts package directory)
const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

// 1. Only watch the Accounts package (prevent watching entire monorepo)
config.watchFolders = [projectRoot];

// 2. Configure nodeModulesPaths for proper workspace resolution
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// 3. Force Metro to resolve (sub)dependencies in the workspace
config.resolver.disableHierarchicalLookup = true;

// 4. Enable better platform resolution
config.resolver.platforms = ['native', 'android', 'ios', 'tsx', 'ts', 'web'];

// 5. Add alias resolver for @/ paths
config.resolver.extraNodeModules = {
  '@': projectRoot,
};

module.exports = config;




