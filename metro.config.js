// metro.config.js
// Safety net: if any transitive dependency imports Node's 'buffer' module,
// Metro resolves it to our polyfill shim instead of crashing.

const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

config.resolver = config.resolver || {};
config.resolver.extraNodeModules = Object.assign(
  {},
  config.resolver.extraNodeModules || {},
  {
    buffer: path.resolve(__dirname, 'src/polyfills/buffer-shim.js'),
  }
);

module.exports = config;
