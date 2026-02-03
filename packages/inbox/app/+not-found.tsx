import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Link, Stack } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

export default function NotFoundScreen() {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 900;

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.code, { color: colors.border }]}>404</Text>
        <Text style={[styles.title, { color: colors.text }]}>Page not found</Text>
        <Text style={[styles.description, { color: colors.secondaryText }]}>
          The page you're looking for doesn't exist or has been moved.
        </Text>
        <Link
          href="/"
          style={[
            styles.link,
            {
              color: colors.primary,
              borderColor: colors.primary,
            },
            isDesktop && styles.linkDesktop,
          ]}
        >
          Go to Inbox
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  code: {
    fontSize: 120,
    fontWeight: '700',
    lineHeight: 130,
    letterSpacing: -2,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    marginTop: 8,
  },
  description: {
    fontSize: 15,
    marginTop: 8,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 22,
  },
  link: {
    marginTop: 24,
    fontSize: 15,
    fontWeight: '600',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 24,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  linkDesktop: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    fontSize: 16,
  },
});
