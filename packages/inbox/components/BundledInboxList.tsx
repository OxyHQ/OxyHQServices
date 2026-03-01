/**
 * Bundled inbox view — groups messages by label into collapsible bundles.
 * Inspired by Inbox by Gmail: each label becomes a collapsible section
 * with a colored accent, count badge, and "Done" action to archive the group.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { toast } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { SPECIAL_USE } from '@/constants/mailbox';
import { useEmailStore } from '@/hooks/useEmail';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import {
  useToggleStar,
  useArchiveMessage,
} from '@/hooks/mutations/useMessageMutations';
import { MessageRow } from '@/components/MessageRow';
import { SwipeableRow } from '@/components/SwipeableRow';
import type { Message, Label } from '@/services/emailApi';

interface LabelBundle {
  labelName: string;
  color: string;
  messages: Message[];
  newestDate: string;
}

function groupByLabel(
  messages: Message[],
  labels: Label[],
): { bundles: LabelBundle[]; unbundled: Message[] } {
  const labelColorMap = new Map(labels.map((l) => [l.name, l.color]));
  const bundleMap = new Map<string, Message[]>();
  const unbundled: Message[] = [];

  for (const msg of messages) {
    if (msg.labels.length > 0) {
      // Group by first label
      const primaryLabel = msg.labels[0];
      const existing = bundleMap.get(primaryLabel);
      if (existing) {
        existing.push(msg);
      } else {
        bundleMap.set(primaryLabel, [msg]);
      }
    } else {
      unbundled.push(msg);
    }
  }

  const bundles: LabelBundle[] = [];
  for (const [labelName, msgs] of bundleMap) {
    bundles.push({
      labelName,
      color: labelColorMap.get(labelName) || '#5F6368',
      messages: msgs,
      newestDate: msgs[0].date, // messages already sorted by date desc
    });
  }

  // Sort bundles by most recent message
  bundles.sort((a, b) => new Date(b.newestDate).getTime() - new Date(a.newestDate).getTime());

  return { bundles, unbundled };
}

interface BundledInboxListProps {
  messages: Message[];
  labels: Label[];
  labelColorMap: Map<string, string>;
  replaceNavigation?: boolean;
}

export function BundledInboxList({
  messages,
  labels,
  labelColorMap,
  replaceNavigation,
}: BundledInboxListProps) {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const selectedMessageId = useEmailStore((s) => s.selectedMessageId);

  const { data: mailboxes = [] } = useMailboxes();
  const toggleStar = useToggleStar();
  const archiveMutation = useArchiveMessage();

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const { bundles, unbundled } = useMemo(
    () => groupByLabel(messages, labels),
    [messages, labels],
  );

  const toggleCollapse = useCallback((labelName: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(labelName)) {
        next.delete(labelName);
      } else {
        next.add(labelName);
      }
      return next;
    });
  }, []);

  const handleStar = useCallback(
    (messageId: string) => {
      if (toggleStar.isPending) return;
      const msg = messages.find((m) => m._id === messageId);
      if (msg) toggleStar.mutate({ messageId, starred: !msg.flags.starred });
    },
    [messages, toggleStar],
  );

  const handleMessagePress = useCallback(
    (messageId: string) => {
      if (replaceNavigation) {
        router.replace(`/conversation/${messageId}`);
      } else {
        router.push(`/conversation/${messageId}`);
      }
    },
    [router, replaceNavigation],
  );

  const handleDoneBundle = useCallback(
    (bundleMessages: Message[]) => {
      const archiveBox = mailboxes.find((m) => m.specialUse === SPECIAL_USE.ARCHIVE);
      if (!archiveBox) {
        toast.error('Archive folder not available.');
        return;
      }
      bundleMessages.forEach((msg) => {
        archiveMutation.mutate({ messageId: msg._id, archiveMailboxId: archiveBox._id });
      });
    },
    [mailboxes, archiveMutation],
  );

  return (
    <View>
      {bundles.map((bundle) => {
        const isCollapsed = collapsed.has(bundle.labelName);
        return (
          <View
            key={bundle.labelName}
            style={[
              styles.bundleContainer,
              { borderColor: colors.border },
            ]}
          >
            {/* Colored left accent */}
            <View style={[styles.bundleAccent, { backgroundColor: bundle.color }]} />

            {/* Bundle header */}
            <TouchableOpacity
              style={[styles.bundleHeader, { backgroundColor: colors.surface }]}
              onPress={() => toggleCollapse(bundle.labelName)}
              activeOpacity={0.7}
            >
              <View style={styles.bundleHeaderLeft}>
                <View style={[styles.bundleDot, { backgroundColor: bundle.color }]} />
                <Text style={[styles.bundleLabelName, { color: colors.text }]}>
                  {bundle.labelName}
                </Text>
                <View style={[styles.bundleCount, { backgroundColor: bundle.color + '20' }]}>
                  <Text style={[styles.bundleCountText, { color: bundle.color }]}>
                    {bundle.messages.length}
                  </Text>
                </View>
              </View>
              <View style={styles.bundleHeaderRight}>
                <TouchableOpacity
                  onPress={() => handleDoneBundle(bundle.messages)}
                  style={[styles.doneButton, { backgroundColor: colors.surfaceVariant }]}
                  activeOpacity={0.7}
                  hitSlop={4}
                >
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon as unknown as IconSvgElement}
                      size={14}
                      color={colors.success}
                    />
                  ) : (
                    <MaterialCommunityIcons
                      name="check-circle-outline"
                      size={14}
                      color={colors.success}
                    />
                  )}
                  <Text style={[styles.doneText, { color: colors.success }]}>Done</Text>
                </TouchableOpacity>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon
                    icon={
                      (isCollapsed ? ArrowDown01Icon : ArrowUp01Icon) as unknown as IconSvgElement
                    }
                    size={18}
                    color={colors.secondaryText}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={isCollapsed ? 'chevron-down' : 'chevron-up'}
                    size={18}
                    color={colors.secondaryText}
                  />
                )}
              </View>
            </TouchableOpacity>

            {/* Bundle messages */}
            {!isCollapsed &&
              bundle.messages.map((msg, index) => (
                <React.Fragment key={msg._id}>
                  {index > 0 && (
                    <View
                      style={[styles.separator, { backgroundColor: colors.border }]}
                    />
                  )}
                  <SwipeableRow
                    onArchive={() => {
                      const archiveBox = mailboxes.find(
                        (m) => m.specialUse === SPECIAL_USE.ARCHIVE,
                      );
                      if (archiveBox) {
                        archiveMutation.mutate({
                          messageId: msg._id,
                          archiveMailboxId: archiveBox._id,
                        });
                      }
                    }}
                    onDelete={() => {}}
                  >
                    <MessageRow
                      message={msg}
                      onStar={handleStar}
                      onSelect={handleMessagePress}
                      isSelected={msg._id === selectedMessageId}
                      labelColorMap={labelColorMap}
                    />
                  </SwipeableRow>
                </React.Fragment>
              ))}
          </View>
        );
      })}

      {/* Unbundled messages (no labels) */}
      {unbundled.length > 0 && (
        <View style={[styles.bundleContainer, { borderColor: colors.border }]}>
          <View style={[styles.bundleAccent, { backgroundColor: colors.secondaryText }]} />
          <TouchableOpacity
            style={[styles.bundleHeader, { backgroundColor: colors.surface }]}
            onPress={() => toggleCollapse('__other__')}
            activeOpacity={0.7}
          >
            <View style={styles.bundleHeaderLeft}>
              <View style={[styles.bundleDot, { backgroundColor: colors.secondaryText }]} />
              <Text style={[styles.bundleLabelName, { color: colors.text }]}>Other</Text>
              <View
                style={[
                  styles.bundleCount,
                  { backgroundColor: colors.secondaryText + '20' },
                ]}
              >
                <Text style={[styles.bundleCountText, { color: colors.secondaryText }]}>
                  {unbundled.length}
                </Text>
              </View>
            </View>
            <View style={styles.bundleHeaderRight}>
              {Platform.OS === 'web' ? (
                <HugeiconsIcon
                  icon={
                    (collapsed.has('__other__')
                      ? ArrowDown01Icon
                      : ArrowUp01Icon) as unknown as IconSvgElement
                  }
                  size={18}
                  color={colors.secondaryText}
                />
              ) : (
                <MaterialCommunityIcons
                  name={collapsed.has('__other__') ? 'chevron-down' : 'chevron-up'}
                  size={18}
                  color={colors.secondaryText}
                />
              )}
            </View>
          </TouchableOpacity>

          {!collapsed.has('__other__') &&
            unbundled.map((msg, index) => (
              <React.Fragment key={msg._id}>
                {index > 0 && (
                  <View
                    style={[styles.separator, { backgroundColor: colors.border }]}
                  />
                )}
                <SwipeableRow
                  onArchive={() => {
                    const archiveBox = mailboxes.find(
                      (m) => m.specialUse === SPECIAL_USE.ARCHIVE,
                    );
                    if (archiveBox) {
                      archiveMutation.mutate({
                        messageId: msg._id,
                        archiveMailboxId: archiveBox._id,
                      });
                    }
                  }}
                  onDelete={() => {}}
                >
                  <MessageRow
                    message={msg}
                    onStar={handleStar}
                    onSelect={handleMessagePress}
                    isSelected={msg._id === selectedMessageId}
                    labelColorMap={labelColorMap}
                  />
                </SwipeableRow>
              </React.Fragment>
            ))}
        </View>
      )}

      {/* Empty state when no messages at all */}
      {messages.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            No messages to display.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bundleContainer: {
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  bundleAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  bundleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 16,
    paddingLeft: 12,
  },
  bundleHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bundleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  bundleLabelName: {
    fontSize: 15,
    fontWeight: '600',
  },
  bundleCount: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 24,
    alignItems: 'center',
  },
  bundleCountText: {
    fontSize: 12,
    fontWeight: '700',
  },
  bundleHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  doneText: {
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 12,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 14,
  },
});
