module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      [
        'babel-preset-expo',
        {
          // zustand/middleware's ESM build reads `import.meta.env`, which is a
          // SyntaxError in Metro's non-module web bundle — polyfill it.
          unstable_transformImportMeta: true,
        },
      ],
    ],
  };
};
