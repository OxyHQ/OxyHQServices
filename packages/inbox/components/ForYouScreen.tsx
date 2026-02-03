/**
 * "For You" screen — curated highlights using the full content width.
 *
 * Shows starred messages, unread highlights, and recent attachments
 * in a card-based layout that spans both columns.
 */

import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useEmailStore } from '@/hooks/useEmail';
import { Avatar } from '@/components/Avatar';
import type { Message } from '@/services/emailApi';

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function ForYouScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;

  const { data: mailboxes = [] } = useMailboxes();
  const inboxId = mailboxes.find((m) => m.specialUse === 'Inbox')?._id;
  const { data, isLoading } = useMessages(inboxId);

  const messages = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  const starred = useMemo(() => messages.filter((m) => m.flags.starred).slice(0, 6), [messages]);
  const unread = useMemo(() => messages.filter((m) => !m.flags.seen && !m.flags.starred).slice(0, 6), [messages]);
  const withAttachments = useMemo(
    () => messages.filter((m) => m.attachments.length > 0).slice(0, 6),
    [messages],
  );

  const handleOpenDrawer = () => navigation.dispatch(DrawerActions.openDrawer());

  const handleMessagePress = (messageId: string) => {
    useEmailStore.setState({ selectedMessageId: messageId });
    router.push(`/conversation/${messageId}`);
  };

  // Responsive grid: 1 col on narrow, 2 on medium, 3 on wide
  const contentWidth = isDesktop ? width - 280 : width;
  const numColumns = contentWidth >= 900 ? 3 : contentWidth >= 600 ? 2 : 1;

  const renderMessageCard = (message: Message) => {
    const senderName = message.from.name || message.from.address.split('@')[0];
    return (
      <TouchableOpacity
        key={message._id}
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            width: numColumns > 1 ? `${Math.floor(100 / numColumns) - 2}%` as any : '100%',
          },
        ]}
        onPress={() => handleMessagePress(message._id)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Avatar name={senderName} size={32} />
          <View style={styles.cardHeaderText}>
            <Text style={[styles.cardSender, { color: colors.text }]} numberOfLines={1}>
              {senderName}
            </Text>
            <Text style={[styles.cardTime, { color: colors.secondaryText }]}>
              {formatRelativeDate(message.date)}
            </Text>
          </View>
        </View>
        <Text style={[styles.cardSubject, { color: colors.text }]} numberOfLines={1}>
          {message.subject || '(no subject)'}
        </Text>
        <Text style={[styles.cardPreview, { color: colors.secondaryText }]} numberOfLines={2}>
          {message.text || ''}
        </Text>
        {message.attachments.length > 0 && (
          <View style={styles.cardAttachments}>
            {message.attachments.slice(0, 2).map((att, i) => (
              <View key={i} style={[styles.attachmentChip, { backgroundColor: colors.surfaceVariant }]}>
                <MaterialCommunityIcons name="paperclip" size={12} color={colors.secondaryText} />
                <Text style={[styles.attachmentText, { color: colors.secondaryText }]} numberOfLines={1}>
                  {att.filename}
                </Text>
              </View>
            ))}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  const renderSection = (
    title: string,
    icon: keyof typeof MaterialCommunityIcons.glyphMap,
    items: Message[],
    iconColor: string,
  ) => {
    if (items.length === 0) return null;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
          <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.sectionCount, { color: colors.secondaryText }]}>{items.length}</Text>
        </View>
        <View style={styles.cardGrid}>
          {items.map(renderMessageCard)}
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border },
          !isDesktop && { paddingTop: insets.top },
        ]}
      >
        {!isDesktop && (
          <TouchableOpacity onPress={handleOpenDrawer} style={styles.iconButton}>
            <MaterialCommunityIcons name="menu" size={24} color={colors.icon} />
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>For You</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.bodyContent,
            { maxWidth: 1200, alignSelf: 'center' as const, width: '100%' },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {renderSection('Starred', 'star', starred, colors.starred)}
          {renderSection('Unread', 'email-outline', unread, colors.primary)}
          {renderSection('Attachments', 'paperclip', withAttachments, colors.icon)}

          {starred.length === 0 && unread.length === 0 && withAttachments.length === 0 && (
            <View style={styles.emptyContainer}>
              <MaterialCommunityIcons name="inbox-outline" size={64} color={colors.border} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>All caught up</Text>
              <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
                Nothing highlighted for you right now.
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
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
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '500',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  cardHeaderText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardSender: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  cardTime: {
    fontSize: 11,
  },
  cardSubject: {
    fontSize: 14,
    fontWeight: '600',
  },
  cardPreview: {
    fontSize: 13,
    lineHeight: 18,
  },
  cardAttachments: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 2,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  attachmentText: {
    fontSize: 11,
    maxWidth: 120,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
  },
});
