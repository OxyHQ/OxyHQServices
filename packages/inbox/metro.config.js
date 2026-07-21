const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts = [...config.resolver.assetExts, 'woff2', 'woff'];

const nativeWindConfig = withNativeWind(config, {
  input: './global.css',
  inlineRem: 16,
  inlineVariables: false,
});

const parentResolveRequest = nativeWindConfig.resolver.resolveRequest;
const BLOOM_ORIGIN = path.join(__dirname, 'package.json');

nativeWindConfig.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (moduleName === 'ws' || moduleName === 'node:ws')) {
    return { type: 'empty' };
  }

  const resolveContext =
    moduleName === '@oxyhq/bloom' || moduleName.startsWith('@oxyhq/bloom/')
      ? { ...context, originModulePath: BLOOM_ORIGIN }
      : context;

  return parentResolveRequest(resolveContext, moduleName, platform);
};

module.exports = nativeWindConfig;
