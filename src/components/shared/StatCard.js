/**
 * Small summary metric card used on dashboards.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../../theme/colors';

export default function StatCard({ label, value, icon, accentColor = Colors.primary, bgColor }) {
  return (
    <View style={[styles.card, bgColor ? { backgroundColor: bgColor } : null]}>
      <View style={[styles.iconWrap, { backgroundColor: accentColor + '22' }]}>
        <Text style={{ fontSize: 20 }}>{icon}</Text>
      </View>
      <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
    minWidth: 100,
    margin: 4,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  value: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 2,
  },
  label: {
    fontSize: 11,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
});
