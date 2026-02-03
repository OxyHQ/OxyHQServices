/**
 * Email detail / reader screen.
 *
 * Shows full email content with actions (reply, archive, delete, star).
 */

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { Avatar } from '@/components/Avatar';
import type { EmailAddress } from '@/services/emailApi';

function formatFullDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatRecipients(addresses: EmailAddress[]): string {
  return addresses.map((a) => a.name || a.address).join(', ');
}

export default function MessageScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { oxyServices } = useOxy();

  const { currentMessage, loadMessage, clearCurrentMessage, toggleStar, archiveMessage, deleteMessage } =
    useEmailStore();

  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const token = oxyServices.httpService.getAccessToken();
        if (token && id) await loadMessage(token, id);
      } catch {}
    };
    load();
    return () => clearCurrentMessage();
  }, [id]);

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleStar = useCallback(async () => {
    if (!id) return;
    try {
      const token = oxyServices.httpService.getAccessToken();
      if (token) await toggleStar(token, id);
    } catch {}
  }, [id, oxyServices, toggleStar]);

  const handleArchive = useCallback(async () => {
    if (!id) return;
    try {
      const token = oxyServices.httpService.getAccessToken();
      if (token) await archiveMessage(token, id);
      router.back();
    } catch {}
  }, [id, oxyServices, archiveMessage, router]);

  const handleDelete = useCallback(async () => {
    if (!id) return;
    try {
      const token = oxyServices.httpService.getAccessToken();
      if (token) await deleteMessage(token, id);
      router.back();
    } catch {}
  }, [id, oxyServices, deleteMessage, router]);

  const handleReply = useCallback(() => {
    if (!currentMessage) return;
    router.push({
      pathname: '/compose',
      params: {
        replyTo: currentMessage._id,
        to: currentMessage.from.address,
        toName: currentMessage.from.name || '',
        subject: currentMessage.subject.startsWith('Re:')
          ? currentMessage.subject
          : `Re: ${currentMessage.subject}`,
      },
    });
  }, [router, currentMessage]);

  const handleForward = useCallback(() => {
    if (!currentMessage) return;
    router.push({
      pathname: '/compose',
      params: {
        forward: currentMessage._id,
        subject: currentMessage.subject.startsWith('Fwd:')
          ? currentMessage.subject
          : `Fwd: ${currentMessage.subject}`,
        body: `\n\n---------- Forwarded message ----------\nFrom: ${currentMessage.from.name || currentMessage.from.address}\nDate: ${formatFullDate(currentMessage.date)}\nSubject: ${currentMessage.subject}\nTo: ${formatRecipients(currentMessage.to)}\n\n${currentMessage.text || ''}`,
      },
    });
  }, [router, currentMessage]);

  if (!currentMessage) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.toolbar}>
          <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
          </TouchableOpacity>
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  const senderName = currentMessage.from.name || currentMessage.from.address.split('@')[0];
  const maxContentWidth = Math.min(width, 720);

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      {/* Toolbar */}
      <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
        </TouchableOpacity>
        <View style={styles.toolbarSpacer} />
        <TouchableOpacity onPress={handleArchive} style={styles.iconButton}>
          <MaterialCommunityIcons name="archive-outline" size={22} color={colors.icon} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDelete} style={styles.iconButton}>
          <MaterialCommunityIcons name="delete-outline" size={22} color={colors.icon} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleStar} style={styles.iconButton}>
          <MaterialCommunityIcons
            name={currentMessage.flags.starred ? 'star' : 'star-outline'}
            size={22}
            color={currentMessage.flags.starred ? colors.starred : colors.icon}
          />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={[styles.bodyContent, { maxWidth: maxContentWidth, alignSelf: 'center', width: '100%' }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Subject */}
        <Text style={[styles.subject, { color: colors.text }]}>{currentMessage.subject || '(no subject)'}</Text>

        {/* Sender header */}
        <View style={styles.senderRow}>
          <Avatar name={senderName} size={40} />
          <View style={styles.senderInfo}>
            <View style={styles.senderNameRow}>
              <Text style={[styles.senderName, { color: colors.text }]}>{senderName}</Text>
              <Text style={[styles.messageDate, { color: colors.secondaryText }]}>
                {formatFullDate(currentMessage.date)}
              </Text>
            </View>
            <TouchableOpacity onPress={() => setExpanded(!expanded)}>
              <Text style={[styles.toLine, { color: colors.secondaryText }]} numberOfLines={expanded ? 5 : 1}>
                to {formatRecipients(currentMessage.to)}
                {currentMessage.cc && currentMessage.cc.length > 0
                  ? `, cc: ${formatRecipients(currentMessage.cc)}`
                  : ''}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Attachments */}
        {currentMessage.attachments.length > 0 && (
          <View style={[styles.attachmentsBar, { borderColor: colors.border }]}>
            {currentMessage.attachments.map((att, i) => (
              <View key={i} style={[styles.attachmentChip, { backgroundColor: colors.surfaceVariant }]}>
                <MaterialCommunityIcons name="paperclip" size={14} color={colors.secondaryText} />
                <Text style={[styles.attachmentName, { color: colors.text }]} numberOfLines={1}>
                  {att.filename}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Body */}
        <View style={styles.messageBody}>
          <Text style={[styles.bodyText, { color: colors.text }]}>
            {currentMessage.text || '(empty message)'}
          </Text>
        </View>
      </ScrollView>

      {/* Bottom reply bar */}
      <View
        style={[
          styles.replyBar,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.replyButton, { borderColor: colors.border }]}
          onPress={handleReply}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="reply" size={18} color={colors.icon} />
          <Text style={[styles.replyButtonText, { color: colors.text }]}>Reply</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.replyButton, { borderColor: colors.border }]}
          onPress={handleForward}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="share" size={18} color={colors.icon} />
          <Text style={[styles.replyButtonText, { color: colors.text }]}>Forward</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarSpacer: {
    flex: 1,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: 16,
    paddingBottom: 32,
  },
  subject: {
    fontSize: 22,
    fontWeight: '400',
    lineHeight: 30,
    marginBottom: 16,
  },
  senderRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  senderInfo: {
    flex: 1,
  },
  senderNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  senderName: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  messageDate: {
    fontSize: 12,
  },
  toLine: {
    fontSize: 13,
    marginTop: 2,
  },
  attachmentsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  attachmentName: {
    fontSize: 13,
    maxWidth: 180,
  },
  messageBody: {
    marginTop: 8,
  },
  bodyText: {
    fontSize: 15,
    lineHeight: 24,
  },
  replyBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  replyButtonText: {
    fontSize: 14,
    fontWeight: '500',
  },
});
