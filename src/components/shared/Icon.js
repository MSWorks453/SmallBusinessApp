/**
 * src/components/shared/Icon.js
 * Icon component that loads MaterialIcons font explicitly.
 *
 * API: <MaterialIcons name="home" size={24} color="#000" style={...} />
 */
import React from 'react';
import { Text, Platform } from 'react-native';
import { useFonts } from 'expo-font';

// Glyph map: icon name → unicode codepoint (from MaterialIcons.json)
const glyphMap = require('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/MaterialIcons.json');

const FONT_FAMILY = 'material-icons';
const fontAsset = require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/MaterialIcons.ttf');

let fontLoaded = false;

export function useMaterialIconsFont() {
  const [loaded] = useFonts({ [FONT_FAMILY]: fontAsset });
  fontLoaded = loaded;
  return loaded;
}

export function MaterialIcons({ name, size = 24, color = '#000', style }) {
  const code = glyphMap[name];
  if (!code) return null;

  const glyph = String.fromCodePoint(code);

  return (
    <Text
      style={[
        {
          fontFamily: FONT_FAMILY,
          fontSize: size,
          lineHeight: size * (Platform.OS === 'ios' ? 1.2 : 1.15),
          height: size,
          width: size,
          textAlign: 'center',
          textAlignVertical: 'center',
          color: color,
          includeFontPadding: false,
        },
        style,
      ]}
      allowFontScaling={false}
    >
      {glyph}
    </Text>
  );
}

export default MaterialIcons;
