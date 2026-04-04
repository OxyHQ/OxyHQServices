import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy } from '@oxyhq/services';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';

export default function ThirdPartyConnectionsScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const { isAuthenticated, isLoading: authLoading } = useOxy();

  if (authLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.text }]}>Loading...</Text>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title="Third-party connections"
        subtitle="Manage apps and services connected to your account."
        message="Please sign in to manage your third-party connections."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  const renderContent = () => (
    <View style={styles.emptyState}>
      <MaterialCommunityIcons
        name="application-outline"
        size={48}
        color={colors.icon}
      />
      <Text style={[styles.emptyTitle, { color: colors.text }]}>
        No connected apps yet
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.text }]}>
        When you grant third-party apps access to your Oxy account, they will appear here.
      </Text>
    </View>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title="Third-party connections" subtitle="Manage apps and services connected to your account." />
        {renderContent()}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title="Third-party connections" subtitle="Manage apps and services connected to your account." />
          {renderContent()}
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-SemiBold',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    opacity: 0.6,
    textAlign: 'center',
    lineHeight: 20,
  },
  mobileContent: {
    padding: 16,
    paddingBottom: 120,
  },
});
