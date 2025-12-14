import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { AccountCard, ScreenHeader } from '@/components/ui';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { useOxy } from '@oxyhq/services';
import type { AccountStorageUsageResponse } from '@oxyhq/services';

export default function StorageScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 768;

  const handlePressIn = useHapticPress();

  const { oxyServices, isAuthenticated, isLoading: oxyLoading } = useOxy();
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

  const usageSummaryText = useMemo(() => {
    if (!usage) return '';
    const used = formatBytes(usage.totalUsedBytes).text;
    const total = formatBytes(usage.totalLimitBytes).text;
    return `${used} of ${total} used`;
  }, [formatBytes, usage]);

  const segments = useMemo(() => {
    const total = usage?.totalLimitBytes ?? 0;
    const cats = usage?.categories;
    const safe = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    const documents = safe(cats?.documents?.bytes);
    const mail = safe(cats?.mail?.bytes);
    const photosVideos = safe(cats?.photosVideos?.bytes);
    const recordings = safe(cats?.recordings?.bytes);
    const family = safe(cats?.family?.bytes);

    const used = documents + mail + photosVideos + recordings + family;
    const remaining = Math.max(0, total - used);

    const toPct = (b: number) => (total > 0 ? (b / total) * 100 : 0);

    return [
      { key: 'documents', color: colors.sidebarIconSecurity, pct: toPct(documents) },
      { key: 'mail', color: colors.sidebarIconSharing, pct: toPct(mail) },
      { key: 'photosVideos', color: colors.sidebarIconPayments, pct: toPct(photosVideos) },
      { key: 'recordings', color: colors.sidebarIconData, pct: toPct(recordings) },
      { key: 'family', color: colors.sidebarIconPersonalInfo, pct: toPct(family) },
      { key: 'remaining', color: colors.border, pct: toPct(remaining) },
    ].filter((s) => s.pct > 0.2); // avoid tiny slivers that look like rendering glitches
  }, [colors.border, colors.sidebarIconData, colors.sidebarIconPayments, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconSharing, usage]);

  const storageDetails = useMemo(() => {
    const cats = usage?.categories;
    const safe = (v?: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

    return [
      {
        key: 'documents',
        label: 'Documents',
        color: colors.sidebarIconSecurity,
        bytes: safe(cats?.documents?.bytes),
        onPress: () => router.push('/(tabs)/data'),
      },
      {
        key: 'mail',
        label: 'Oxy Mail',
        color: colors.sidebarIconSharing,
        bytes: safe(cats?.mail?.bytes),
        onPress: () => router.push('/(tabs)/data'),
      },
      {
        key: 'photosVideos',
        label: 'Photos & Videos',
        color: colors.sidebarIconPayments,
        bytes: safe(cats?.photosVideos?.bytes),
        onPress: () => router.push('/(tabs)/data'),
      },
      {
        key: 'recordings',
        label: 'Recordings',
        color: colors.sidebarIconData,
        bytes: safe(cats?.recordings?.bytes),
        onPress: () => router.push('/(tabs)/data'),
      },
      {
        key: 'family',
        label: 'Family storage',
        color: colors.sidebarIconPersonalInfo,
        bytes: safe(cats?.family?.bytes),
        onPress: () => router.push('/(tabs)/family'),
        subtitle: '5 members',
      },
    ];
  }, [colors.sidebarIconData, colors.sidebarIconPayments, colors.sidebarIconPersonalInfo, colors.sidebarIconSecurity, colors.sidebarIconSharing, router, usage]);

  const handleCleanup = useCallback(() => {
    router.push('/(tabs)/data');
  }, [router]);

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

      <AccountCard>
        <View style={styles.hero}>
          <ThemedText style={[styles.heroTitle, { color: colors.text }]}>
            {`You've got ${usage ? formatBytes(usage.totalLimitBytes).text : ''} of storage`}
          </ThemedText>
          <ThemedText style={[styles.heroSubtitle, { color: colors.secondaryText }]}>
            Your storage is shared across Oxy Photos, Oxy Drive, and Oxy Mail.
          </ThemedText>

          <TouchableOpacity
            style={[styles.primaryButton, { backgroundColor: colors.sidebarIconSecurity }]}
            onPressIn={handlePressIn}
            onPress={handleCleanup}
            activeOpacity={0.85}
            disabled={loading || oxyLoading}
          >
            <Text style={styles.primaryButtonText}>Clean up space</Text>
          </TouchableOpacity>

          <View style={styles.usageRow}>
            {loading || oxyLoading ? (
              <View style={styles.usageLoading}>
                <ActivityIndicator size="small" color={colors.tint} />
                <Text style={[styles.usageText, { color: colors.text }]}>Loading usage…</Text>
              </View>
            ) : error ? (
              <Text style={[styles.usageText, { color: colors.sidebarIconSharing }]} numberOfLines={2}>
                {error}
              </Text>
            ) : (
              <>
                <Text style={[styles.usageText, { color: colors.text }]}>{usageSummaryText}</Text>
                <MaterialCommunityIcons name="information-outline" size={18} color={colors.secondaryText} />
              </>
            )}
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

          <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>STORAGE DETAILS</Text>

          <View style={[styles.detailsCard, { backgroundColor: colors.background }]}>
            {storageDetails.map((row, idx) => (
              <TouchableOpacity
                key={row.key}
                style={[
                  styles.detailRow,
                  idx < storageDetails.length - 1 ? { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth } : null,
                ]}
                onPressIn={handlePressIn}
                onPress={row.onPress}
                activeOpacity={0.7}
              >
                <View style={styles.detailLeft}>
                  <View style={[styles.dot, { backgroundColor: row.color }]} />
                  <View style={styles.detailLabels}>
                    <Text style={[styles.detailTitle, { color: colors.text }]}>{row.label}</Text>
                    {'subtitle' in row && row.subtitle ? (
                      <Text style={[styles.detailSubtitle, { color: colors.secondaryText }]}>{row.subtitle}</Text>
                    ) : null}
                  </View>
                </View>

                <View style={styles.detailRight}>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{formatBytes(row.bytes).text}</Text>
                  <MaterialCommunityIcons name="open-in-new" size={18} color={colors.secondaryText} />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </AccountCard>
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
  hero: {
    padding: 18,
    gap: 14,
  },
  heroTitle: {
    fontSize: 26,
    fontWeight: '700',
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 420,
    alignSelf: 'center',
  },
  primaryButton: {
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 999,
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  usageRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  usageLoading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  usageText: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
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
  sectionLabel: {
    marginTop: 6,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  detailsCard: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  detailRow: {
    paddingVertical: 14,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  detailLabels: {
    flexDirection: 'column',
    gap: 2,
    flex: 1,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  detailSubtitle: {
    fontSize: 12,
    fontWeight: '500',
  },
  detailRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
  },
});

