/**
 * Gmail-style message row for the inbox list.
 *
 * Shows sender, subject, preview, and mini-card previews for attachments.
 * Supports multi-select via avatar checkbox (web hover / native long-press).
 */

import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  StarIcon,
  Image01Icon,
  PlayCircle02Icon,
  MusicNote01Icon,
  Pdf01Icon,
  Xls01Icon,
  Ppt01Icon,
  Doc01Icon,
  FileZipIcon,
  File01Icon,
  Attachment01Icon,
} from '@hugeicons/core-free-icons';
import { Avatar } from './Avatar';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { Message, Attachment } from '@/services/emailApi';

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

type AttachmentInfo = {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  hugeIcon: IconSvgElement;
  label: string;
  color: string;
};

function getAttachmentInfo(att: Attachment): AttachmentInfo {
  const ct = att.contentType.toLowerCase();
  if (ct.startsWith('image/')) return { icon: 'image-outline', hugeIcon: Image01Icon as unknown as IconSvgElement, label: att.filename, color: '#34A853' };
  if (ct.startsWith('video/')) return { icon: 'play-circle-outline', hugeIcon: PlayCircle02Icon as unknown as IconSvgElement, label: att.filename, color: '#EA4335' };
  if (ct.startsWith('audio/')) return { icon: 'music-note-outline', hugeIcon: MusicNote01Icon as unknown as IconSvgElement, label: att.filename, color: '#9334E6' };
  if (ct.includes('pdf')) return { icon: 'file-pdf-box', hugeIcon: Pdf01Icon as unknown as IconSvgElement, label: att.filename, color: '#EA4335' };
  if (ct.includes('spreadsheet') || ct.includes('excel') || ct.includes('csv'))
    return { icon: 'file-excel-outline', hugeIcon: Xls01Icon as unknown as IconSvgElement, label: att.filename, color: '#34A853' };
  if (ct.includes('presentation') || ct.includes('powerpoint'))
    return { icon: 'file-powerpoint-outline', hugeIcon: Ppt01Icon as unknown as IconSvgElement, label: att.filename, color: '#E8710A' };
  if (ct.includes('document') || ct.includes('word') || ct.includes('msword'))
    return { icon: 'file-word-outline', hugeIcon: Doc01Icon as unknown as IconSvgElement, label: att.filename, color: '#1A73E8' };
  if (ct.includes('zip') || ct.includes('rar') || ct.includes('tar') || ct.includes('gz'))
    return { icon: 'zip-box-outline', hugeIcon: FileZipIcon as unknown as IconSvgElement, label: att.filename, color: '#5F6368' };
  return { icon: 'file-outline', hugeIcon: File01Icon as unknown as IconSvgElement, label: att.filename, color: '#5F6368' };
}

export function MessageRow({
  message,
  onStar,
  onSelect,
  isSelected,
  isSelectionMode,
  isMultiSelected,
  onToggleSelect,
  onLongPress,
}: {
  message: Message;
  onStar: (id: string) => void;
  onSelect: (id: string) => void;
  isSelected?: boolean;
  isSelectionMode?: boolean;
  isMultiSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPress?: (id: string) => void;
}) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isUnread = !message.flags.seen;
  const [avatarHovered, setAvatarHovered] = useState(false);

  const showCheckbox = isSelectionMode || (Platform.OS === 'web' && avatarHovered);

  const handlePress = useCallback(() => {
    if (isSelectionMode && onToggleSelect) {
      onToggleSelect(message._id);
    } else {
      onSelect(message._id);
    }
  }, [message._id, onSelect, onToggleSelect, isSelectionMode]);

  const handleLongPress = useCallback(() => {
    if (Platform.OS !== 'web' && onLongPress) {
      try {
        const Haptics = require('expo-haptics');
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
      onLongPress(message._id);
    }
  }, [message._id, onLongPress]);

  const handleAvatarPress = useCallback(() => {
    if (onToggleSelect) {
      onToggleSelect(message._id);
    }
  }, [message._id, onToggleSelect]);

  const handleStar = useCallback(() => {
    onStar(message._id);
  }, [onStar, message._id]);

  const senderName = getSenderName(message);
  const preview = getPreview(message);
  const dateStr = formatDate(message.date);
  const hasAttachments = message.attachments.length > 0;

  const rowBg = isMultiSelected
    ? colors.selectedRow
    : isSelected
      ? colors.selectedRow
      : isUnread
        ? colors.surface
        : colors.background;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.container,
        { backgroundColor: rowBg },
        pressed && { opacity: 0.7 },
      ]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={500}
    >
      <Pressable
        onPress={showCheckbox ? handleAvatarPress : undefined}
        hitSlop={4}
        {...(Platform.OS === 'web' ? {
          onMouseEnter: () => setAvatarHovered(true),
          onMouseLeave: () => setAvatarHovered(false),
        } as any : {})}
      >
        <Avatar
          name={senderName}
          size={40}
          showCheckbox={showCheckbox}
          isChecked={isMultiSelected}
        />
      </Pressable>

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
          <TouchableOpacity onPress={handleStar} hitSlop={8} style={styles.starButton}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon
                icon={StarIcon as unknown as IconSvgElement}
                size={16}
                color={message.flags.starred ? colors.starred : colors.icon}
                strokeWidth={message.flags.starred ? 1.5 : 1.5}
                fill={message.flags.starred ? colors.starred : 'none'}
              />
            ) : (
              <MaterialCommunityIcons
                name={message.flags.starred ? 'star' : 'star-outline'}
                size={20}
                color={message.flags.starred ? colors.starred : colors.icon}
              />
            )}
          </TouchableOpacity>
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
        </View>

        {/* Attachment mini-cards */}
        {hasAttachments && (
          <View style={styles.attachmentRow}>
            {message.attachments.slice(0, 3).map((att, i) => {
              const info = getAttachmentInfo(att);
              return (
                <View
                  key={i}
                  style={[styles.attachmentCard, { borderColor: colors.border }]}
                >
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon icon={info.hugeIcon} size={14} color={info.color} />
                  ) : (
                    <MaterialCommunityIcons name={info.icon as any} size={14} color={info.color} />
                  )}
                  <Text style={[styles.attachmentLabel, { color: colors.text }]} numberOfLines={1}>
                    {info.label}
                  </Text>
                </View>
              );
            })}
            {message.attachments.length > 3 && (
              <Text style={[styles.moreAttachments, { color: colors.secondaryText }]}>
                +{message.attachments.length - 3}
              </Text>
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
    gap: 8,
  },
  sender: {
    fontSize: 14,
    flex: 1,
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
  attachmentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 140,
  },
  attachmentLabel: {
    fontSize: 11,
    flex: 1,
  },
  moreAttachments: {
    fontSize: 11,
    alignSelf: 'center',
    paddingHorizontal: 4,
  },
  starButton: {
    padding: 2,
  },
});
