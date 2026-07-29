module.exports = function (api) {
  api.cache(true)
  return {
    presets: ["babel-preset-expo"],
    // react-native-reanimated (a dependency of @shopify/react-native-skia) needs
    // its babel plugin, and it MUST be the last plugin listed.
    plugins: ["react-native-reanimated/plugin"],
  }
}
