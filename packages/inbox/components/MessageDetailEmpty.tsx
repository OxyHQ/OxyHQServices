import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { EmptyIllustration } from '@/components/EmptyIllustration';

export function MessageDetailEmpty() {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <EmptyIllustration size={180} />
      <Text style={[styles.text, { color: colors.secondaryText }]}>Select a conversation</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    fontSize: 16,
  },
});
