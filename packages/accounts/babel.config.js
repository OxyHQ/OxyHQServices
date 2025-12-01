module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // resolver must come first for proper module resolution
      [
        'module-resolver',
        {
          root: ['./'], // Ensure it resolves relative to package root
          alias: { '@': './' },
          extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        },
      ],
    ],
  };
};

