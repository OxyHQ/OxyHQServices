import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader, LinkButton } from '@/components/ui';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useOxy } from '@oxyhq/services';
import type { AccountStorageUsageResponse } from '@oxyhq/core';
import { useRelativeTime } from '@/hooks/useRelativeTime';
import { useTranslation } from '@/lib/i18n';
import { alert } from '@oxyhq/bloom';

export default function StorageScreen() {
  const colors = useColors();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const isDesktop = Platform.OS === 'web' && width >= 768;
  const { t } = useTranslation();

  // Auth is enforced by the `(tabs)` layout — assume a session here.
  const { oxyServices, isLoading: oxyLoading } = useOxy();
  const [usage, setUsage] = useState<AccountStorageUsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    if (!oxyServices) return;
    setLoading(true);
    setError(null);
    try {
      const res = await oxyServices.getAccountStorageUsage();
      setUsage(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('storage.loadFailed');
      setError(message);
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, [oxyServices, t]);

  const handleRefresh = useCallback(async () => {
    if (!oxyServices) return;
    setRefreshing(true);
    setError(null);
    try {
      const res = await oxyServices.getAccountStorageUsage();
      setUsage(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('storage.loadFailed');
      setError(message);
    } finally {
      setRefreshing(false);
    }
  }, [oxyServices, t]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const formatBytes = useCallback((bytes: number) => {
    const abs = Math.abs(bytes);
    const KB = 1024;
    const MB = KB * 1024;
    const GB = MB * 1024;
    const TB = GB * 1024;

    const format = (value: number, unit: string, decimals: number) => ({
      value,
      unit,
      text: `${value.toFixed(decimals)} ${unit}`,
    });

    if (abs >= TB) return format(bytes / TB, 'TB', bytes % TB === 0 ? 0 : 2);
    if (abs >= GB) return format(bytes / GB, 'GB', bytes % GB === 0 ? 0 : 2);
    if (abs >= MB) return format(bytes / MB, 'MB', 2);
    if (abs >= KB) return format(bytes / KB, 'KB', 2);
    return { value: bytes, unit: 'B', text: `${bytes} B` };
  }, []);

  const relativeTime = useRelativeTime();

  const usagePercentage = useMemo(() => {
    if (!usage || usage.totalLimitBytes === 0) return 0;
    return Math.round((usage.totalUsedBytes / usage.totalLimitBytes) * 100);
  }, [usage]);

  const usageSummaryText = useMemo(() => {
    if (!usage) return '';
    const used = formatBytes(usage.totalUsedBytes).text;
    const total = formatBytes(usage.totalLimitBytes).text;
    return t('storage.usageSummary', { used, total });
  }, [formatBytes, usage, t]);

  const planDisplayName = useMemo(() => {
    if (!usage) return '';
    const plan = usage.plan;
    return plan.charAt(0).toUpperCase() + plan.slice(1);
  }, [usage]);

  const segments = useMemo(() => {
    const total = usage?.totalLimitBytes ?? 0;
    const cats = usage?.categories;
    const safe = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    const documents = safe(cats?.documents?.bytes);
    const mail = safe(cats?.mail?.bytes);
    const photosVideos = safe(cats?.photosVideos?.bytes);
    const recordings = safe(cats?.recordings?.bytes);
    const family = safe(cats?.family?.bytes);
    const other = safe(cats?.other?.bytes);

    const used = documents + mail + photosVideos + recordings + family + other;
    const remaining = Math.max(0, total - used);

    const toPct = (b: number) => (total > 0 ? (b / total) * 100 : 0);

    return [
      { key: 'documents', color: colors.sidebarIconSecurity, pct: toPct(documents) },
      { key: 'mail', color: colors.sidebarIconSharing, pct: toPct(mail) },
      { key: 'photosVideos', color: colors.sidebarIconPayments, pct: toPct(photosVideos) },
      { key: 'recordings', color: colors.sidebarIconData, pct: toPct(recordings) },
      { key: 'family', color: colors.sidebarIconPersonalInfo, pct: toPct(family) },
      { key: 'other', color: colors.textSecondary, pct: toPct(other) },
      { key: 'remaining', color: colors.border, pct: toPct(remaining) },
    ].filter((s) => s.pct > 0.2); // avoid tiny slivers that look like rendering glitches
  }, [colors.border, colors.sidebarIconData, colors.sidebarIconPayments, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconSharing, colors.textSecondary, usage]);

  const handleCategoryPress = useCallback((categoryId: string, categoryName: string, bytes: number, count: number) => {
    const sizeText = formatBytes(bytes).text;
    const countTextKey = categoryId === 'mail'
      ? 'storage.categories.messages'
      : categoryId === 'photosVideos'
        ? 'storage.categories.items'
        : categoryId === 'recordings'
          ? 'storage.categories.recordingsCount'
          : 'storage.categories.files';
    const countText = t(countTextKey, { count });
    const percentage = usage && usage.totalLimitBytes > 0
      ? Math.round((bytes / usage.totalLimitBytes) * 100)
      : 0;

    alert(
      categoryName,
      t('storage.detail.summary', { size: sizeText, count: countText, percent: percentage }),
      [{ text: t('common.ok') }]
    );
  }, [alert, formatBytes, usage, t]);

  const storageDetails = useMemo(() => {
    const cats = usage?.categories;
    const safe = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const safeCount = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    const docsCount = safeCount(cats?.documents?.count);
    const mailCount = safeCount(cats?.mail?.count);
    const photosCount = safeCount(cats?.photosVideos?.count);
    const recCount = safeCount(cats?.recordings?.count);
    const famCount = safeCount(cats?.family?.count);

    const items = [
      {
        id: 'documents',
        icon: 'file-document-outline',
        iconColor: colors.sidebarIconSecurity,
        title: t('storage.categories.documents'),
        subtitle: t('storage.categories.files', { count: docsCount }),
        bytes: safe(cats?.documents?.bytes),
        onPress: () => handleCategoryPress('documents', t('storage.categories.documents'), safe(cats?.documents?.bytes), docsCount),
        showChevron: false,
      },
      {
        id: 'mail',
        icon: 'email-outline',
        iconColor: colors.sidebarIconSharing,
        title: t('storage.categories.mail'),
        subtitle: t('storage.categories.messages', { count: mailCount }),
        bytes: safe(cats?.mail?.bytes),
        onPress: () => handleCategoryPress('mail', t('storage.categories.mail'), safe(cats?.mail?.bytes), mailCount),
        showChevron: false,
      },
      {
        id: 'photosVideos',
        icon: 'image-outline',
        iconColor: colors.sidebarIconPayments,
        title: t('storage.categories.photosVideos'),
        subtitle: t('storage.categories.items', { count: photosCount }),
        bytes: safe(cats?.photosVideos?.bytes),
        onPress: () => handleCategoryPress('photosVideos', t('storage.categories.photosVideos'), safe(cats?.photosVideos?.bytes), photosCount),
        showChevron: false,
      },
      {
        id: 'recordings',
        icon: 'microphone-outline',
        iconColor: colors.sidebarIconData,
        title: t('storage.categories.recordings'),
        subtitle: t('storage.categories.recordingsCount', { count: recCount }),
        bytes: safe(cats?.recordings?.bytes),
        onPress: () => handleCategoryPress('recordings', t('storage.categories.recordings'), safe(cats?.recordings?.bytes), recCount),
        showChevron: false,
      },
      {
        id: 'family',
        icon: 'account-group-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: t('storage.categories.family'),
        subtitle: t('storage.categories.files', { count: famCount }),
        bytes: safe(cats?.family?.bytes),
        onPress: () => router.push('/(tabs)/family'),
        showChevron: true,
      },
    ];

    // Add "Other" category if it has data
    if (safe(cats?.other?.bytes) > 0) {
      const otherCount = safeCount(cats?.other?.count);
      items.push({
        id: 'other',
        icon: 'folder-outline',
        iconColor: colors.textSecondary,
        title: t('storage.categories.other'),
        subtitle: t('storage.categories.files', { count: otherCount }),
        bytes: safe(cats?.other?.bytes),
        onPress: () => handleCategoryPress('other', t('storage.categories.other'), safe(cats?.other?.bytes), otherCount),
        showChevron: false,
      });
    }

    return items;
  }, [colors.sidebarIconData, colors.sidebarIconPayments, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconSharing, colors.textSecondary, handleCategoryPress, router, usage, t]);

  const accountInfoItems = useMemo(() => {
    if (!usage) return [];
    return [
      {
        id: 'plan',
        icon: 'crown-outline',
        iconColor: colors.sidebarIconPayments,
        title: t('storage.info.plan'),
        subtitle: planDisplayName,
        showChevron: false,
      },
      {
        id: 'updated',
        icon: 'clock-outline',
        iconColor: colors.textSecondary,
        title: t('storage.info.updated'),
        subtitle: relativeTime(usage.updatedAt, t('storage.info.never')),
        showChevron: false,
      },
    ];
  }, [colors.sidebarIconPayments, colors.textSecondary, relativeTime, planDisplayName, usage, t]);

  const content = (
    <>
      <ScreenHeader title={t('storage.title')} subtitle={t('storage.subtitle')} />

      <Section title={t('storage.sections.overview')}>
        <AccountCard>
          <View style={styles.overviewContainer}>
            {loading || oxyLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.tint} />
                <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('storage.loading')}</ThemedText>
              </View>
            ) : error ? (
              <View style={styles.errorContainer}>
                <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.sidebarIconSharing} />
                <ThemedText style={[styles.errorText, { color: colors.text }]}>{error}</ThemedText>
                <TouchableOpacity
                  style={[styles.retryButton, { backgroundColor: colors.tint }]}
                  onPress={loadUsage}
                  accessibilityRole="button"
                  accessibilityLabel={t('storage.retry')}
                >
                  <Text style={styles.retryButtonText}>{t('storage.retry')}</Text>
                </TouchableOpacity>
              </View>
            ) : usage ? (
              <>
                <View style={styles.usageHeader}>
                  <ThemedText style={[styles.usageTitle, { color: colors.text }]}>
                    {usageSummaryText}
                  </ThemedText>
                  <ThemedText style={[styles.usagePercentage, { color: colors.textSecondary }]}>
                    {t('storage.usagePercentage', { percent: usagePercentage })}
                  </ThemedText>
                </View>

                <View style={[styles.usageBar, { backgroundColor: colors.border }]}>
                  <View style={styles.usageBarInner}>
                    {segments.map((segment) => (
                      <View
                        key={segment.key}
                        style={[
                          styles.usageSegment,
                          { backgroundColor: segment.color, width: `${segment.pct}%` },
                        ]}
                      />
                    ))}
                  </View>
                </View>

                <ThemedText style={[styles.usageSubtitle, { color: colors.textSecondary }]}>
                  {t('storage.usageShared')}
                </ThemedText>
              </>
            ) : null}
          </View>
        </AccountCard>
      </Section>

      {usage && (
        <>
          <Section title={t('storage.sections.accountInfo')}>
            <AccountCard>
              <GroupedSection items={accountInfoItems} />
            </AccountCard>
          </Section>

          <Section title={t('storage.sections.byCategory')}>
            <AccountCard>
              <GroupedSection
                items={storageDetails.map((item) => ({
                  ...item,
                  customContent: (
                    <View style={styles.storageValue}>
                      <ThemedText style={[styles.storageValueText, { color: colors.text }]}>
                        {formatBytes(item.bytes).text}
                      </ThemedText>
                    </View>
                  ),
                }))}
              />
            </AccountCard>
          </Section>

          <Section>
            <View style={{ marginTop: -8 }}>
              <LinkButton text={t('storage.cleanUp')} onPress={() => router.push('/(tabs)/data')} />
            </View>
          </Section>
        </>
      )}
    </>
  );

  if (isDesktop) {
    return content;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenContentWrapper refreshing={refreshing} onRefresh={handleRefresh}>
        <View style={styles.mobileContent}>{content}</View>
      </ScreenContentWrapper>
    </View>
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
  overviewContainer: {
    padding: 16,
    gap: 16,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 15,
    fontWeight: '500',
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  errorText: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 18,
    marginTop: 8,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  usageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  usageTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  usagePercentage: {
    fontSize: 15,
    fontWeight: '500',
  },
  usageBar: {
    height: 10,
    borderRadius: 6,
    overflow: 'hidden',
  },
  usageBarInner: {
    flexDirection: 'row',
    height: '100%',
    width: '100%',
  },
  usageSegment: {
    height: '100%',
  },
  usageSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  storageValue: {
    marginLeft: 8,
  },
  storageValueText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
