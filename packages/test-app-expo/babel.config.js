module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { unstable_transformImportMeta: true }],
    ],
    plugins: [
      // resolver must come first for proper module resolution
      ['module-resolver', {
        root: ['./'],
        alias: { '@': './' },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.svg'],
      }],
      '@babel/plugin-syntax-dynamic-import',
      '@babel/plugin-transform-export-namespace-from',
      // react-native-worklets/plugin replaces react-native-reanimated/plugin
      // (reanimated 4.x re-exports the worklets plugin) and MUST be LAST.
      'react-native-worklets/plugin',
    ],
  };
};
