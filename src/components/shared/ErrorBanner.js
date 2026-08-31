/**
 * Inline error banner with optional retry action.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialIcons } from './Icon';
import { Colors } from '../../theme/colors';

export default function ErrorBanner({ message, onRetry }) {
  return (
    <View style={styles.container}>
      <MaterialIcons name="warning" size={18} color={Colors.danger} style={styles.icon} />
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <TouchableOpacity style={styles.retryBtn} onPress={onRetry} accessibilityRole="button">
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    margin: 16,
    padding: 16,
    backgroundColor: Colors.dangerLight,
    borderRadius: 10,
    borderLeftWidth: 4,
    borderLeftColor: Colors.danger,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  icon: { marginRight: 8 },
  message: {
    flex: 1,
    fontSize: 13,
    color: Colors.danger,
    fontWeight: '500',
  },
  retryBtn: {
    backgroundColor: Colors.danger,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  retryText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
});
