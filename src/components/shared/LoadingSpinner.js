/**
 * Reusable full-screen loading overlay.
 */
import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import Colors from '../../theme/colors';

export default function LoadingSpinner({ message = 'Loading…' }) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 12,
  },
});
