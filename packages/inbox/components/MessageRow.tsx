/**
 * Gmail-style message row for the inbox list.
 *
 * Shows sender, subject, preview, and mini-card previews for attachments.
 */

import React, { useCallback, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
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
}: {
  message: Message;
  onStar: (id: string) => void;
  onSelect: (id: string) => void;
  isSelected?: boolean;
}) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isUnread = !message.flags.seen;

  const handlePress = useCallback(() => {
    onSelect(message._id);
  }, [message._id, onSelect]);

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
        { backgroundColor: isSelected ? colors.selectedRow : isUnread ? colors.surface : colors.background },
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

      <TouchableOpacity onPress={handleStar} hitSlop={8} style={styles.starButton}>
        {Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={StarIcon as unknown as IconSvgElement}
            size={16}
            color={message.flags.starred ? colors.starred : colors.icon}
            strokeWidth={message.flags.starred ? 2.5 : 1.5}
          />
        ) : (
          <MaterialCommunityIcons
            name={message.flags.starred ? 'star' : 'star-outline'}
            size={20}
            color={message.flags.starred ? colors.starred : colors.icon}
          />
        )}
      </TouchableOpacity>
    </TouchableOpacity>
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
    padding: 4,
    marginTop: 0,
  },
});
