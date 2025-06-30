module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["metro-react-native-babel-preset", { unstable_transformImportMeta: true }]],
  };
};