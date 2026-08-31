/**
 * src/polyfills/buffer-shim.js
 *
 * Minimal Buffer polyfill for React Native.
 * react-native-svg@15.x imports `buffer` only for its fetchData utility
 * (used for SVG-from-URI loading). We provide the subset it actually needs
 * so the bundler doesn't crash. Full Buffer semantics are not required
 * because react-native-chart-kit never calls the URI-fetch path.
 */

// Use the global Buffer if the runtime already provides one (Hermes does not,
// but some environments do).
const BufferImpl =
  typeof global !== 'undefined' && global.Buffer
    ? global.Buffer
    : {
        from: function (data, encoding) {
          // Minimal stub — returns a Uint8Array for string input
          if (typeof data === 'string') {
            const arr = [];
            for (let i = 0; i < data.length; i++) {
              arr.push(data.charCodeAt(i) & 0xff);
            }
            return new Uint8Array(arr);
          }
          return new Uint8Array(data || []);
        },
        isBuffer: function (obj) {
          return obj instanceof Uint8Array;
        },
        alloc: function (size, fill) {
          const arr = new Uint8Array(size);
          if (fill !== undefined) arr.fill(typeof fill === 'string' ? fill.charCodeAt(0) : fill);
          return arr;
        },
        concat: function (list) {
          let total = 0;
          for (const item of list) total += item.length;
          const result = new Uint8Array(total);
          let offset = 0;
          for (const item of list) {
            result.set(item, offset);
            offset += item.length;
          }
          return result;
        },
      };

module.exports = { Buffer: BufferImpl };
