const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Shim Node.js-only modules for web builds (engine.io-client pulls in ws)
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (moduleName === 'ws' || moduleName === 'node:ws')) {
    return { type: 'empty' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
