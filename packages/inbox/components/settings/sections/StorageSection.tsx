/**
 * Storage subscreen — quota usage + housekeeping.
 *
 * The hero block is a visual usage card with a percentage, a slim progress
 * bar, and the formatted used/free figures — designed to feel less like a
 * row and more like a dashboard tile.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import { Admonition } from '@oxyhq/bloom/admonition';
import { Loading } from '@oxyhq/bloom/loading';
import {
  FloppyDisk_Stroke2_Corner0_Rounded,
  ArrowOutOfBox_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { useQuota } from '@/hooks/queries/useQuota';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function StorageSection() {
  const colors = useColors();
  const theme = useTheme();
  const { data: quota, isLoading } = useQuota();

  const isLow = quota ? quota.percentage > 90 : false;
  const progressColor = isLow ? colors.error : theme.colors.primary;
  const usedPct = quota ? Math.min(quota.percentage, 100) : 0;

  return (
    <View style={styles.root}>
      <View style={styles.subsection}>
        <SectionHeader icon={FloppyDisk_Stroke2_Corner0_Rounded} title="Mailbox usage" />
        <View style={[styles.usageCard, { backgroundColor: theme.colors.backgroundSecondary }]}>
          {isLoading && !quota ? (
            <View style={styles.usageLoading}>
              <Loading variant="inline" size="small" />
            </View>
          ) : null}
          {quota ? (
            <>
              <View style={styles.usageHeader}>
                <Text style={[styles.usagePercent, { color: colors.text }]}>
                  {`${quota.percentage}%`}
                </Text>
                <Text style={[styles.usageSubtitle, { color: colors.secondaryText }]}>
                  {`${formatBytes(quota.used)} of ${formatBytes(quota.limit)}`}
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: progressColor, width: `${usedPct}%` },
                  ]}
                />
              </View>
              <Text style={[styles.usageHint, { color: colors.secondaryText }]}>
                {`${formatBytes(Math.max(0, quota.limit - quota.used))} free`}
              </Text>
            </>
          ) : null}
        </View>
        {isLow ? (
          <Admonition type="warning">
            You're nearly out of space. Old messages will start to bounce when the quota is full.
          </Admonition>
        ) : null}
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={ArrowOutOfBox_Stroke2_Corner0_Rounded} title="Local cache" />
        <Text style={[styles.body, { color: colors.secondaryText }]}>
          The most recent 100 messages are cached on this device for fast offline access. Attachments are downloaded on demand and cleaned up automatically — there's nothing to manage manually today.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 28,
  },
  subsection: {
    gap: 12,
  },
  usageCard: {
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  usageLoading: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  usageHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  usagePercent: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
  },
  usageSubtitle: {
    fontSize: 13,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  usageHint: {
    fontSize: 13,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
});
