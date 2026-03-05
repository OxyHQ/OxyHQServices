const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..', '..');

const config = getDefaultConfig(projectRoot);

// Watch workspace packages for hot reload during development
config.watchFolders = [
  monorepoRoot,
];

// Resolve @oxyhq/* packages to their source for development
config.resolver.extraNodeModules = {
  '@oxyhq/core': path.resolve(monorepoRoot, 'packages', 'core', 'src', 'index.ts'),
  '@oxyhq/services': path.resolve(monorepoRoot, 'packages', 'services', 'src', 'index.ts'),
  '@oxyhq/services/ui': path.resolve(monorepoRoot, 'packages', 'services', 'src', 'ui'),
};

module.exports = config;
