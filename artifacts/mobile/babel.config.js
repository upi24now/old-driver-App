module.exports = function (api) {
  api.cache(true);
  return {
    presets: [["babel-preset-expo", { unstable_transformImportMeta: true }]],
    // react-native-reanimated/plugin MUST be last.
    // It transforms useAnimatedStyle / useAnimatedProps / runOnUI callbacks
    // into worklets (serialisable closures the Worklets runtime can execute on
    // the UI thread).  Without it the runtime receives a plain JS function and
    // throws "[Worklets] Failed to create a worklet" at startup.
    //
    // In Reanimated 4 this file re-exports react-native-worklets/plugin, which
    // is the same underlying transformer — the import path is unchanged from v3.
    plugins: ["react-native-reanimated/plugin"],
  };
};
