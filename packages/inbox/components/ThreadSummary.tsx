/**
 * Thread Summary component.
 *
 * Shows AI-generated summary, key points, and action items for long threads.
 * Collapsible by default with expand/collapse functionality.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  AiChat02Icon,
  CheckListIcon,
  ArrowDown01Icon,
  ArrowUp01Icon,
} from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useThreadSummary, type ActionItem } from '@/hooks/queries/useThreadSummary';
import type { Message } from '@/services/emailApi';

interface ThreadSummaryProps {
  messages: Message[];
  minMessages?: number;
}

function ActionItemRow({
  item,
  colors,
}: {
  item: ActionItem;
  colors: ReturnType<typeof Colors['light']>;
}) {
  return (
    <View style={styles.actionItem}>
      <MaterialCommunityIcons
        name="checkbox-blank-outline"
        size={16}
        color={colors.primary}
      />
      <View style={styles.actionItemContent}>
        <Text style={[styles.actionItemText, { color: colors.text }]}>
          {item.text}
        </Text>
        {(item.owner || item.deadline) && (
          <View style={styles.actionItemMeta}>
            {item.owner && (
              <Text style={[styles.actionItemOwner, { color: colors.secondaryText }]}>
                {item.owner}
              </Text>
            )}
            {item.deadline && (
              <Text style={[styles.actionItemDeadline, { color: colors.primary }]}>
                Due: {item.deadline}
              </Text>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

export function ThreadSummary({ messages, minMessages = 4 }: ThreadSummaryProps) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const [expanded, setExpanded] = useState(true);

  const { summary, keyPoints, actionItems, isLoading, error } = useThreadSummary(
    messages,
    { minMessages }
  );

  // Don't render if not enough messages or no summary
  if (messages.length < minMessages) {
    return null;
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={AiChat02Icon as unknown as IconSvgElement} size={18} color={colors.primary} />
            ) : (
              <MaterialCommunityIcons name="robot-outline" size={18} color={colors.primary} />
            )}
            <Text style={[styles.headerTitle, { color: colors.text }]}>Thread Summary</Text>
          </View>
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
        <View style={styles.loadingContent}>
          <View style={[styles.skeletonLine, { backgroundColor: colors.border }]} />
          <View style={[styles.skeletonLine, styles.skeletonLineMedium, { backgroundColor: colors.border }]} />
        </View>
      </View>
    );
  }

  // Don't render if no content
  if (!summary && keyPoints.length === 0 && actionItems.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surfaceVariant, borderColor: colors.border }]}>
      <TouchableOpacity
        style={styles.header}
        onPress={() => setExpanded(!expanded)}
        activeOpacity={0.7}
      >
        <View style={styles.headerLeft}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={AiChat02Icon as unknown as IconSvgElement} size={18} color={colors.primary} />
          ) : (
            <MaterialCommunityIcons name="robot-outline" size={18} color={colors.primary} />
          )}
          <Text style={[styles.headerTitle, { color: colors.text }]}>Thread Summary</Text>
          <View style={[styles.badge, { backgroundColor: colors.primary + '20' }]}>
            <Text style={[styles.badgeText, { color: colors.primary }]}>
              {messages.length} messages
            </Text>
          </View>
        </View>
        {Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={(expanded ? ArrowUp01Icon : ArrowDown01Icon) as unknown as IconSvgElement}
            size={18}
            color={colors.icon}
          />
        ) : (
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.icon}
          />
        )}
      </TouchableOpacity>

      {expanded && (
        <View style={styles.content}>
          {/* Summary */}
          {summary && (
            <Text style={[styles.summary, { color: colors.text }]}>{summary}</Text>
          )}

          {/* Key Points */}
          {keyPoints.length > 0 && (
            <View style={styles.keyPointsSection}>
              <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>
                Key Points
              </Text>
              {keyPoints.map((point, index) => (
                <View key={index} style={styles.keyPoint}>
                  <View style={[styles.keyPointBullet, { backgroundColor: colors.primary }]} />
                  <Text style={[styles.keyPointText, { color: colors.text }]}>{point}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Action Items */}
          {actionItems.length > 0 && (
            <View style={styles.actionItemsSection}>
              <View style={styles.actionItemsHeader}>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={CheckListIcon as unknown as IconSvgElement} size={14} color={colors.secondaryText} />
                ) : (
                  <MaterialCommunityIcons name="checkbox-marked-outline" size={14} color={colors.secondaryText} />
                )}
                <Text style={[styles.sectionLabel, { color: colors.secondaryText }]}>
                  Action Items
                </Text>
              </View>
              {actionItems.map((item, index) => (
                <ActionItemRow key={index} item={item} colors={colors} />
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  summary: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  keyPointsSection: {
    marginBottom: 12,
  },
  keyPoint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 4,
  },
  keyPointBullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    marginTop: 6,
  },
  keyPointText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  actionItemsSection: {
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.1)',
  },
  actionItemsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },
  actionItemContent: {
    flex: 1,
  },
  actionItemText: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionItemMeta: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 2,
  },
  actionItemOwner: {
    fontSize: 11,
  },
  actionItemDeadline: {
    fontSize: 11,
    fontWeight: '600',
  },
  loadingContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  skeletonLine: {
    height: 14,
    borderRadius: 4,
    opacity: 0.3,
  },
  skeletonLineMedium: {
    width: '70%',
  },
});
