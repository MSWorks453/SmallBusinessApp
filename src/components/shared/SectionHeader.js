/**
 * Consistent section header used inside screen cards.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Colors from '../../theme/colors';

export default function SectionHeader({ title, subtitle, accent = Colors.primary }) {
  return (
    <View style={[styles.container, { borderLeftColor: accent }]}>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    marginBottom: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
});
