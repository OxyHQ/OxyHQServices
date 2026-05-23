import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, Text, ActivityIndicator } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy } from '@oxyhq/services';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useTranslation } from '@/lib/i18n';

export default function ThirdPartyConnectionsScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const { isAuthenticated, isLoading: authLoading } = useOxy();
  const { t } = useTranslation();

  if (authLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.text }]}>{t('common.loadingShort')}</Text>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title={t('family.title')}
        subtitle={t('family.subtitle')}
        message={t('family.signInRequired')}
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
        {t('family.emptyTitle')}
      </Text>
      <Text style={[styles.emptySubtitle, { color: colors.text }]}>
        {t('family.emptySubtitle')}
      </Text>
    </View>
  );

  if (isDesktop) {
    return (
      <>
        <ScreenHeader title={t('family.title')} subtitle={t('family.subtitle')} />
        {renderContent()}
      </>
    );
  }

  return (
    <ScreenContentWrapper>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.mobileContent}>
          <ScreenHeader title={t('family.title')} subtitle={t('family.subtitle')} />
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
