import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader, LinkButton, useAlert } from '@/components/ui';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy } from '@oxyhq/services';
import type { AccountStorageUsageResponse } from '@oxyhq/core';
import { formatDate } from '@/utils/date-utils';

export default function StorageScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const { oxyServices, isAuthenticated, isLoading: oxyLoading } = useOxy();
  const alert = useAlert();
  const [usage, setUsage] = useState<AccountStorageUsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    if (!isAuthenticated || !oxyServices) return;
    setLoading(true);
    setError(null);
    try {
      const res = await oxyServices.getAccountStorageUsage();
      setUsage(res);
    } catch (err: any) {
      setError(err?.message || 'Failed to load storage usage');
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, oxyServices]);

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

  const formatRelativeTime = useCallback((dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const minutes = Math.floor(diffMs / 60000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return formatDate(dateString);
  }, []);

  const usagePercentage = useMemo(() => {
    if (!usage || usage.totalLimitBytes === 0) return 0;
    return Math.round((usage.totalUsedBytes / usage.totalLimitBytes) * 100);
  }, [usage]);

  const usageSummaryText = useMemo(() => {
    if (!usage) return '';
    const used = formatBytes(usage.totalUsedBytes).text;
    const total = formatBytes(usage.totalLimitBytes).text;
    return `${used} of ${total} used`;
  }, [formatBytes, usage]);

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
      { key: 'other', color: colors.secondaryText, pct: toPct(other) },
      { key: 'remaining', color: colors.border, pct: toPct(remaining) },
    ].filter((s) => s.pct > 0.2); // avoid tiny slivers that look like rendering glitches
  }, [colors.border, colors.sidebarIconData, colors.sidebarIconPayments, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconSharing, colors.secondaryText, usage]);

  const handleCategoryPress = useCallback((categoryId: string, categoryName: string, bytes: number, count: number) => {
    const sizeText = formatBytes(bytes).text;
    const countText = `${count.toLocaleString()} ${categoryId === 'mail' ? 'message' : categoryId === 'photosVideos' ? 'item' : categoryId === 'recordings' ? 'recording' : 'file'}${count !== 1 ? 's' : ''}`;
    const percentage = usage && usage.totalLimitBytes > 0 
      ? Math.round((bytes / usage.totalLimitBytes) * 100) 
      : 0;
    
    alert(
      categoryName,
      `${sizeText} (${countText})\n\nThis category uses ${percentage}% of your total storage.`,
      [{ text: 'OK' }]
    );
  }, [alert, formatBytes, usage]);

  const storageDetails = useMemo(() => {
    const cats = usage?.categories;
    const safe = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const safeCount = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    const items = [
      {
        id: 'documents',
        icon: 'file-document-outline',
        iconColor: colors.sidebarIconSecurity,
        title: 'Documents',
        subtitle: `${safeCount(cats?.documents?.count).toLocaleString()} file${safeCount(cats?.documents?.count) !== 1 ? 's' : ''}`,
        bytes: safe(cats?.documents?.bytes),
        onPress: () => handleCategoryPress('documents', 'Documents', safe(cats?.documents?.bytes), safeCount(cats?.documents?.count)),
        showChevron: false,
      },
      {
        id: 'mail',
        icon: 'email-outline',
        iconColor: colors.sidebarIconSharing,
        title: 'Oxy Mail',
        subtitle: `${safeCount(cats?.mail?.count).toLocaleString()} message${safeCount(cats?.mail?.count) !== 1 ? 's' : ''}`,
        bytes: safe(cats?.mail?.bytes),
        onPress: () => handleCategoryPress('mail', 'Oxy Mail', safe(cats?.mail?.bytes), safeCount(cats?.mail?.count)),
        showChevron: false,
      },
      {
        id: 'photosVideos',
        icon: 'image-outline',
        iconColor: colors.sidebarIconPayments,
        title: 'Photos & Videos',
        subtitle: `${safeCount(cats?.photosVideos?.count).toLocaleString()} item${safeCount(cats?.photosVideos?.count) !== 1 ? 's' : ''}`,
        bytes: safe(cats?.photosVideos?.bytes),
        onPress: () => handleCategoryPress('photosVideos', 'Photos & Videos', safe(cats?.photosVideos?.bytes), safeCount(cats?.photosVideos?.count)),
        showChevron: false,
      },
      {
        id: 'recordings',
        icon: 'microphone-outline',
        iconColor: colors.sidebarIconData,
        title: 'Recordings',
        subtitle: `${safeCount(cats?.recordings?.count).toLocaleString()} recording${safeCount(cats?.recordings?.count) !== 1 ? 's' : ''}`,
        bytes: safe(cats?.recordings?.bytes),
        onPress: () => handleCategoryPress('recordings', 'Recordings', safe(cats?.recordings?.bytes), safeCount(cats?.recordings?.count)),
        showChevron: false,
      },
      {
        id: 'family',
        icon: 'account-group-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: 'Family storage',
        subtitle: `${safeCount(cats?.family?.count).toLocaleString()} file${safeCount(cats?.family?.count) !== 1 ? 's' : ''}`,
        bytes: safe(cats?.family?.bytes),
        onPress: () => router.push('/(tabs)/family'),
        showChevron: true,
      },
    ];

    // Add "Other" category if it has data
    if (safe(cats?.other?.bytes) > 0) {
      items.push({
        id: 'other',
        icon: 'folder-outline',
        iconColor: colors.secondaryText,
        title: 'Other',
        subtitle: `${safeCount(cats?.other?.count).toLocaleString()} file${safeCount(cats?.other?.count) !== 1 ? 's' : ''}`,
        bytes: safe(cats?.other?.bytes),
        onPress: () => handleCategoryPress('other', 'Other', safe(cats?.other?.bytes), safeCount(cats?.other?.count)),
        showChevron: false,
      });
    }

    return items;
  }, [colors.sidebarIconData, colors.sidebarIconPayments, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconSharing, colors.secondaryText, handleCategoryPress, router, usage]);

  const accountInfoItems = useMemo(() => {
    if (!usage) return [];
    return [
      {
        id: 'plan',
        icon: 'crown-outline',
        iconColor: colors.sidebarIconPayments,
        title: 'Storage plan',
        subtitle: planDisplayName,
        showChevron: false,
      },
      {
        id: 'updated',
        icon: 'clock-outline',
        iconColor: colors.secondaryText,
        title: 'Last updated',
        subtitle: formatRelativeTime(usage.updatedAt),
        showChevron: false,
      },
    ];
  }, [colors.sidebarIconPayments, colors.secondaryText, formatRelativeTime, planDisplayName, usage]);

  if (!isAuthenticated && !oxyLoading) {
    return (
      <UnauthenticatedScreen
        title="Oxy storage"
        subtitle="Manage your storage usage and files."
        message="Sign in to see your storage usage."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  const content = (
    <>
      <ScreenHeader title="Oxy storage" subtitle="Manage your storage usage and files." />

      <Section title="Storage overview">
        <AccountCard>
          <View style={styles.overviewContainer}>
            {loading || oxyLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.tint} />
                <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading storage usage…</ThemedText>
              </View>
            ) : error ? (
              <View style={styles.errorContainer}>
                <MaterialCommunityIcons name="alert-circle-outline" size={40} color={colors.sidebarIconSharing} />
                <ThemedText style={[styles.errorText, { color: colors.text }]}>{error}</ThemedText>
                <TouchableOpacity
                  style={[styles.retryButton, { backgroundColor: colors.tint }]}
                  onPress={loadUsage}
                >
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : usage ? (
              <>
                <View style={styles.usageHeader}>
                  <ThemedText style={[styles.usageTitle, { color: colors.text }]}>
                    {usageSummaryText}
                  </ThemedText>
                  <ThemedText style={[styles.usagePercentage, { color: colors.secondaryText }]}>
                    {usagePercentage}% used
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

                <ThemedText style={[styles.usageSubtitle, { color: colors.secondaryText }]}>
                  Your storage is shared across Oxy Photos, Oxy Drive, and Oxy Mail.
                </ThemedText>
              </>
            ) : null}
          </View>
        </AccountCard>
      </Section>

      {usage && (
        <>
          <Section title="Account information">
            <AccountCard>
              <GroupedSection items={accountInfoItems} />
            </AccountCard>
          </Section>

          <Section title="Storage by category">
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
              <LinkButton text="Clean up space" onPress={() => router.push('/(tabs)/data')} />
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
      <ScreenContentWrapper>
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
