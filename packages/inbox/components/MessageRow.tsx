/**
 * Gmail-style message row for the inbox list.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Avatar } from './Avatar';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { Message } from '@/services/emailApi';

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();

  if (isToday) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  const thisYear = date.getFullYear() === now.getFullYear();
  if (thisYear) {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

function getSenderName(message: Message): string {
  if (message.from.name) return message.from.name;
  return message.from.address.split('@')[0];
}

function getPreview(message: Message): string {
  const text = message.text || '';
  return text.replace(/\s+/g, ' ').trim().substring(0, 120);
}

export function MessageRow({
  message,
  onStar,
}: {
  message: Message;
  onStar: (id: string) => void;
}) {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isUnread = !message.flags.seen;

  const handlePress = useCallback(() => {
    router.push(`/message/${message._id}`);
  }, [router, message._id]);

  const handleStar = useCallback(() => {
    onStar(message._id);
  }, [onStar, message._id]);

  const senderName = getSenderName(message);
  const preview = getPreview(message);
  const dateStr = formatDate(message.date);
  const hasAttachments = message.attachments.length > 0;

  return (
    <TouchableOpacity
      style={[
        styles.container,
        { backgroundColor: isUnread ? colors.surface : colors.background },
      ]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Avatar name={senderName} size={40} />

      <View style={styles.content}>
        <View style={styles.topRow}>
          <Text
            style={[
              styles.sender,
              { color: isUnread ? colors.unread : colors.read },
              isUnread && styles.senderUnread,
            ]}
            numberOfLines={1}
          >
            {senderName}
          </Text>
          <Text
            style={[
              styles.date,
              { color: isUnread ? colors.unread : colors.read },
              isUnread && styles.dateUnread,
            ]}
          >
            {dateStr}
          </Text>
        </View>

        <Text
          style={[
            styles.subject,
            { color: isUnread ? colors.unread : colors.read },
            isUnread && styles.subjectUnread,
          ]}
          numberOfLines={1}
        >
          {message.subject || '(no subject)'}
        </Text>

        <View style={styles.bottomRow}>
          <Text style={[styles.preview, { color: colors.secondaryText }]} numberOfLines={1}>
            {preview}
          </Text>
          {hasAttachments && (
            <MaterialCommunityIcons
              name="paperclip"
              size={14}
              color={colors.secondaryText}
              style={styles.attachmentIcon}
            />
          )}
        </View>
      </View>

      <TouchableOpacity onPress={handleStar} hitSlop={8} style={styles.starButton}>
        <MaterialCommunityIcons
          name={message.flags.starred ? 'star' : 'star-outline'}
          size={22}
          color={message.flags.starred ? colors.starred : colors.icon}
        />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sender: {
    fontSize: 14,
    flex: 1,
    marginRight: 8,
  },
  senderUnread: {
    fontWeight: '700',
  },
  date: {
    fontSize: 12,
  },
  dateUnread: {
    fontWeight: '600',
  },
  subject: {
    fontSize: 14,
  },
  subjectUnread: {
    fontWeight: '600',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  preview: {
    fontSize: 13,
    flex: 1,
  },
  attachmentIcon: {
    marginLeft: 4,
  },
  starButton: {
    padding: 4,
  },
});
