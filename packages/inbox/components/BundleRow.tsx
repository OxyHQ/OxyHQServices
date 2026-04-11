/**
 * Collapsible bundle row for the inbox list.
 *
 * Shows bundle name, icon, unread count, and latest message preview.
 * Taps to expand inline, showing bundled messages.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useColors } from '@/constants/theme';
import type { Bundle, Message } from '@/services/emailApi';

interface BundleRowProps {
  bundle: Bundle;
  messages: Message[];
  unreadCount: number;
  isExpanded: boolean;
  onToggle: () => void;
}

export function BundleRow({ bundle, messages, unreadCount, isExpanded, onToggle }: BundleRowProps) {
  const colors = useColors();

  const latestPreview = useMemo(() => {
    if (messages.length === 0) return '';
    const latest = messages[0];
    const sender = latest.from.name || latest.from.address.split('@')[0];
    const subj = latest.subject || '(no subject)';
    return `${sender}: ${subj}`;
  }, [messages]);

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: colors.surface }]}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <View style={[styles.iconCircle, { backgroundColor: bundle.color + '20' }]}>
        <MaterialCommunityIcons
          name={(bundle.icon || 'folder-outline') as any}
          size={20}
          color={bundle.color}
        />
      </View>
      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text style={[styles.name, { color: colors.text }, unreadCount > 0 && styles.nameUnread]}>
            {bundle.name}
          </Text>
          {unreadCount > 0 && (
            <View style={[styles.badge, { backgroundColor: bundle.color }]}>
              <Text style={styles.badgeText}>{unreadCount}</Text>
            </View>
          )}
          <Text style={[styles.count, { color: colors.secondaryText }]}>
            {messages.length}
          </Text>
          <MaterialCommunityIcons
            name={isExpanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.secondaryText}
          />
        </View>
        {!isExpanded && (
          <Text style={[styles.preview, { color: colors.secondaryText }]} numberOfLines={1}>
            {latestPreview}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
  },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  nameUnread: {
    fontWeight: '700',
  },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 10,
    minWidth: 20,
    alignItems: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  count: {
    fontSize: 12,
  },
  preview: {
    fontSize: 13,
  },
});
