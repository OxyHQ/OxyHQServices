import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader } from '@/components/ui';
import { OxySignInButton } from '@oxyhq/services';

interface UnauthenticatedScreenProps {
  title: string;
  subtitle: string;
  message: string;
  isAuthenticated: boolean;
}

export function UnauthenticatedScreen({
  title,
  subtitle,
  message,
  isAuthenticated,
}: UnauthenticatedScreenProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);

  // Don't render if authenticated
  if (isAuthenticated) {
    return null;
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title={title} subtitle={subtitle} />
          <View style={styles.unauthenticatedPlaceholder}>
            <ThemedText style={[styles.placeholderText, { color: colors.text }]}>
              {message}
            </ThemedText>
            <View style={styles.signInButtonWrapper}>
              <OxySignInButton />
            </View>
          </View>
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
  unauthenticatedPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 24,
  },
  placeholderText: {
    fontSize: 16,
    textAlign: 'center',
  },
  signInButtonWrapper: {
    width: '100%',
    maxWidth: 300,
    gap: 12,
    marginTop: 16,
  },
});

