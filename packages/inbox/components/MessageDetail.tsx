/**
 * Reusable message detail view.
 *
 * Supports two modes:
 * - standalone: full-screen route with back button (mobile)
 * - embedded: inline panel without back button (desktop split-view)
 */

import React, { useEffect, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  Linking,
  Pressable,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowLeft01Icon,
  Archive01Icon,
  Delete01Icon,
  StarIcon,
  Attachment01Icon,
  MailReply01Icon,
  MailReplyAll01Icon,
  Forward01Icon,
  MoreHorizontalIcon,
  Mail01Icon,
  SpamIcon,
  LabelIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useMessage } from '@/hooks/queries/useMessage';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useLabels } from '@/hooks/queries/useLabels';
import { useToggleStar, useToggleRead, useArchiveMessage, useDeleteMessage, useUpdateMessageLabels } from '@/hooks/mutations/useMessageMutations';
import { toast } from '@oxyhq/services';
import { Avatar } from '@/components/Avatar';
import { HtmlBody } from '@/components/HtmlBody';
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

interface MessageDetailProps {
  mode: 'standalone' | 'embedded';
  messageId: string;
}

export function MessageDetail({ mode, messageId }: MessageDetailProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

  const { data: currentMessage, isLoading } = useMessage(messageId);
  const { data: mailboxes = [] } = useMailboxes();
  const { data: labels = [] } = useLabels();
  const currentMailbox = useEmailStore((s) => s.currentMailbox);
  const api = useEmailStore((s) => s._api);
  const toggleStar = useToggleStar();
  const toggleRead = useToggleRead();
  const archiveMutation = useArchiveMessage();
  const deleteMutation = useDeleteMessage();
  const updateLabels = useUpdateMessageLabels();

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [moreMenuVisible, setMoreMenuVisible] = useState(false);
  const [labelMenuVisible, setLabelMenuVisible] = useState(false);

  // Reset state when message changes
  useEffect(() => {
    setDetailsExpanded(false);
    setMoreMenuVisible(false);
    setLabelMenuVisible(false);
  }, [messageId]);

  // Auto-mark message as read when opened
  useEffect(() => {
    if (currentMessage && !currentMessage.flags.seen) {
      toggleRead.mutate({ messageId, seen: true });
    }
  }, [messageId, currentMessage?.flags.seen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleStar = useCallback(() => {
    if (!messageId || !currentMessage) return;
    toggleStar.mutate({ messageId, starred: !currentMessage.flags.starred });
  }, [messageId, currentMessage, toggleStar]);

  const handleArchive = useCallback(() => {
    if (!messageId) return;
    const archiveBox = mailboxes.find((m) => m.specialUse === 'Archive');
    if (archiveBox) {
      archiveMutation.mutate({ messageId, archiveMailboxId: archiveBox._id });
    }
    if (mode === 'standalone') router.back();
  }, [messageId, mailboxes, archiveMutation, router, mode]);

  const handleDelete = useCallback(() => {
    if (!messageId) return;
    const trashBox = mailboxes.find((m) => m.specialUse === 'Trash');
    const isInTrash = currentMailbox?.specialUse === 'Trash';
    deleteMutation.mutate({ messageId, trashMailboxId: trashBox?._id, isInTrash });
    if (mode === 'standalone') router.back();
  }, [messageId, mailboxes, currentMailbox, deleteMutation, router, mode]);

  const handleMarkUnread = useCallback(() => {
    if (!messageId) return;
    toggleRead.mutate({ messageId, seen: false });
    setMoreMenuVisible(false);
    if (mode === 'standalone') router.back();
  }, [messageId, toggleRead, router, mode]);

  const handleMarkSpam = useCallback(() => {
    if (!messageId) return;
    const spamBox = mailboxes.find((m) => m.specialUse === '\\Junk');
    if (spamBox) {
      archiveMutation.mutate({ messageId, archiveMailboxId: spamBox._id });
    }
    setMoreMenuVisible(false);
    if (mode === 'standalone') router.back();
  }, [messageId, mailboxes, archiveMutation, router, mode]);

  const navigate = mode === 'embedded' ? router.replace : router.push;

  const handleReply = useCallback(() => {
    if (!currentMessage) return;
    navigate({
      pathname: '/compose',
      params: {
        replyTo: currentMessage._id,
        to: currentMessage.from.address,
        subject: currentMessage.subject.startsWith('Re:')
          ? currentMessage.subject
          : `Re: ${currentMessage.subject}`,
      },
    });
  }, [navigate, currentMessage]);

  const handleReplyAll = useCallback(() => {
    if (!currentMessage) return;
    // Include all To/CC recipients minus self
    const allTo = [currentMessage.from, ...(currentMessage.to || [])];
    const allCc = currentMessage.cc || [];
    navigate({
      pathname: '/compose',
      params: {
        replyTo: currentMessage._id,
        to: allTo.map((a) => a.address).join(','),
        cc: allCc.map((a) => a.address).join(','),
        subject: currentMessage.subject.startsWith('Re:')
          ? currentMessage.subject
          : `Re: ${currentMessage.subject}`,
      },
    });
  }, [navigate, currentMessage]);

  const handleForward = useCallback(() => {
    if (!currentMessage) return;
    navigate({
      pathname: '/compose',
      params: {
        forward: currentMessage._id,
        subject: currentMessage.subject.startsWith('Fwd:')
          ? currentMessage.subject
          : `Fwd: ${currentMessage.subject}`,
        body: `\n\n---------- Forwarded message ----------\nFrom: ${currentMessage.from.name || currentMessage.from.address}\nDate: ${formatFullDate(currentMessage.date)}\nSubject: ${currentMessage.subject}\nTo: ${formatRecipients(currentMessage.to)}\n\n${currentMessage.text || ''}`,
      },
    });
  }, [navigate, currentMessage]);

  const handleAttachment = useCallback(async (s3Key: string, filename: string) => {
    if (!api) return;
    try {
      const url = await api.getAttachmentUrl(s3Key);
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
      } else {
        const FileSystem = require('expo-file-system');
        const Sharing = require('expo-sharing');
        const localUri = FileSystem.documentDirectory + filename;
        const { uri } = await FileSystem.downloadAsync(url, localUri);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          await Linking.openURL(url);
        }
      }
    } catch {
      try {
        const url = await api.getAttachmentUrl(s3Key);
        await Linking.openURL(url);
      } catch {
        toast.error('Failed to download attachment.');
      }
    }
  }, [api]);

  const handleToggleLabel = useCallback((labelId: string) => {
    if (!currentMessage) return;
    const hasLabel = currentMessage.labels.includes(labelId);
    updateLabels.mutate({
      messageId,
      add: hasLabel ? [] : [labelId],
      remove: hasLabel ? [labelId] : [],
    });
  }, [currentMessage, messageId, updateLabels]);

  // Label data for assigned labels
  const assignedLabels = useMemo(() => {
    if (!currentMessage) return [];
    return labels.filter((l) => currentMessage.labels.includes(l._id));
  }, [currentMessage, labels]);

  if (isLoading || !currentMessage) {
    return (
      <View
        style={[
          styles.container,
          { backgroundColor: colors.background },
          mode === 'standalone' && { paddingTop: insets.top },
        ]}
      >
        {mode === 'standalone' && (
          <View style={styles.toolbar}>
            <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
              {Platform.OS === 'web' ? (
                <HugeiconsIcon icon={ArrowLeft01Icon as unknown as IconSvgElement} size={24} color={colors.icon} />
              ) : (
                <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
              )}
            </TouchableOpacity>
          </View>
        )}
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </View>
    );
  }

  const senderName = currentMessage.from.name || currentMessage.from.address.split('@')[0];
  const maxContentWidth = mode === 'standalone' ? Math.min(width, 720) : undefined;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background },
        mode === 'standalone' && { paddingTop: insets.top },
      ]}
    >
      {/* Toolbar */}
      <View style={[styles.toolbar, { borderBottomColor: colors.border }]}>
        {mode === 'standalone' && (
          <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={ArrowLeft01Icon as unknown as IconSvgElement} size={24} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
            )}
          </TouchableOpacity>
        )}
        <View style={styles.toolbarSpacer} />
        <TouchableOpacity onPress={handleArchive} style={styles.iconButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Archive01Icon as unknown as IconSvgElement} size={22} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="archive-outline" size={22} color={colors.icon} />
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleDelete} style={styles.iconButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Delete01Icon as unknown as IconSvgElement} size={22} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="delete-outline" size={22} color={colors.icon} />
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleMarkUnread} style={styles.iconButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Mail01Icon as unknown as IconSvgElement} size={22} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="email-mark-as-unread" size={22} color={colors.icon} />
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleStar} style={styles.iconButton}>
          {Platform.OS === 'web' ? (
            <HugeiconsIcon
              icon={StarIcon as unknown as IconSvgElement}
              size={22}
              color={currentMessage.flags.starred ? colors.starred : colors.icon}
              strokeWidth={1.5}
              fill={currentMessage.flags.starred ? colors.starred : 'none'}
            />
          ) : (
            <MaterialCommunityIcons
              name={currentMessage.flags.starred ? 'star' : 'star-outline'}
              size={22}
              color={currentMessage.flags.starred ? colors.starred : colors.icon}
            />
          )}
        </TouchableOpacity>

        {/* More menu */}
        <View style={styles.moreMenuAnchor}>
          <TouchableOpacity onPress={() => setMoreMenuVisible(!moreMenuVisible)} style={styles.iconButton}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={MoreHorizontalIcon as unknown as IconSvgElement} size={22} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="dots-vertical" size={22} color={colors.icon} />
            )}
          </TouchableOpacity>
          {moreMenuVisible && (
            <>
              <Pressable style={styles.menuBackdrop} onPress={() => setMoreMenuVisible(false)} />
              <View style={[styles.moreMenu, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <TouchableOpacity style={styles.menuItem} onPress={handleMarkUnread} activeOpacity={0.6}>
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon icon={Mail01Icon as unknown as IconSvgElement} size={16} color={colors.icon} />
                  ) : (
                    <MaterialCommunityIcons name="email-mark-as-unread" size={16} color={colors.icon} />
                  )}
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Mark unread</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={handleMarkSpam} activeOpacity={0.6}>
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon icon={SpamIcon as unknown as IconSvgElement} size={16} color={colors.icon} />
                  ) : (
                    <MaterialCommunityIcons name="alert-octagon-outline" size={16} color={colors.icon} />
                  )}
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Report spam</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.menuItem} onPress={() => { setMoreMenuVisible(false); setLabelMenuVisible(true); }} activeOpacity={0.6}>
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon icon={LabelIcon as unknown as IconSvgElement} size={16} color={colors.icon} />
                  ) : (
                    <MaterialCommunityIcons name="label-outline" size={16} color={colors.icon} />
                  )}
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Label</Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>

      {/* Label picker overlay */}
      {labelMenuVisible && (
        <>
          <Pressable style={styles.menuBackdrop} onPress={() => setLabelMenuVisible(false)} />
          <View style={[styles.labelPicker, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.labelPickerTitle, { color: colors.text }]}>Labels</Text>
            {labels.length === 0 && (
              <Text style={[styles.labelPickerEmpty, { color: colors.secondaryText }]}>No labels yet</Text>
            )}
            {labels.map((lbl) => {
              const isAssigned = currentMessage.labels.includes(lbl._id);
              return (
                <TouchableOpacity
                  key={lbl._id}
                  style={styles.labelPickerItem}
                  onPress={() => handleToggleLabel(lbl._id)}
                  activeOpacity={0.6}
                >
                  <View style={[styles.labelDot, { backgroundColor: lbl.color }]} />
                  <Text style={[styles.labelPickerItemText, { color: colors.text }]}>{lbl.name}</Text>
                  {isAssigned && (
                    <MaterialCommunityIcons name="check" size={16} color={colors.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      <ScrollView
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          maxContentWidth ? { maxWidth: maxContentWidth, alignSelf: 'center' as const, width: '100%' } : undefined,
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Subject */}
        <Text style={[styles.subject, { color: colors.text }]}>{currentMessage.subject || '(no subject)'}</Text>

        {/* Label chips */}
        {assignedLabels.length > 0 && (
          <View style={styles.labelChips}>
            {assignedLabels.map((lbl) => (
              <View key={lbl._id} style={[styles.labelChip, { backgroundColor: lbl.color + '20', borderColor: lbl.color + '40' }]}>
                <View style={[styles.labelChipDot, { backgroundColor: lbl.color }]} />
                <Text style={[styles.labelChipText, { color: colors.text }]}>{lbl.name}</Text>
                <TouchableOpacity onPress={() => handleToggleLabel(lbl._id)} hitSlop={4}>
                  <MaterialCommunityIcons name="close" size={12} color={colors.secondaryText} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

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
            <TouchableOpacity onPress={() => setDetailsExpanded(!detailsExpanded)}>
              <Text style={[styles.toLine, { color: colors.secondaryText }]} numberOfLines={detailsExpanded ? 10 : 1}>
                to {formatRecipients(currentMessage.to)}
                {currentMessage.cc && currentMessage.cc.length > 0
                  ? `, cc: ${formatRecipients(currentMessage.cc)}`
                  : ''}
              </Text>
            </TouchableOpacity>

            {/* Expanded sender details */}
            {detailsExpanded && (
              <View style={[styles.senderDetails, { borderTopColor: colors.border }]}>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>From</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {currentMessage.from.name ? `${currentMessage.from.name} <${currentMessage.from.address}>` : currentMessage.from.address}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>To</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>
                    {currentMessage.to.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ')}
                  </Text>
                </View>
                {currentMessage.cc && currentMessage.cc.length > 0 && (
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>Cc</Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {currentMessage.cc.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(', ')}
                    </Text>
                  </View>
                )}
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.secondaryText }]}>Date</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]}>{formatFullDate(currentMessage.date)}</Text>
                </View>
              </View>
            )}
          </View>
        </View>

        {/* Attachments */}
        {currentMessage.attachments.length > 0 && (
          <View style={[styles.attachmentsBar, { borderColor: colors.border }]}>
            {currentMessage.attachments.map((att, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.attachmentChip, { backgroundColor: colors.surfaceVariant }]}
                onPress={() => handleAttachment(att.s3Key, att.filename)}
                activeOpacity={0.7}
              >
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={Attachment01Icon as unknown as IconSvgElement} size={14} color={colors.secondaryText} />
                ) : (
                  <MaterialCommunityIcons name="paperclip" size={14} color={colors.secondaryText} />
                )}
                <Text style={[styles.attachmentName, { color: colors.text }]} numberOfLines={1}>
                  {att.filename}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Body */}
        <View style={styles.messageBody}>
          {currentMessage.html ? (
            <HtmlBody html={currentMessage.html} />
          ) : (
            <Text style={[styles.bodyText, { color: colors.text }]}>
              {currentMessage.text || '(empty message)'}
            </Text>
          )}
        </View>
      </ScrollView>

      {/* Bottom reply bar */}
      <View
        style={[
          styles.replyBar,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: mode === 'standalone' ? insets.bottom + 8 : 8,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.replyButton, { borderColor: colors.border }]}
          onPress={handleReply}
          activeOpacity={0.7}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={MailReply01Icon as unknown as IconSvgElement} size={18} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="reply" size={18} color={colors.icon} />
          )}
          <Text style={[styles.replyButtonText, { color: colors.text }]}>Reply</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.replyButton, { borderColor: colors.border }]}
          onPress={handleReplyAll}
          activeOpacity={0.7}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={MailReplyAll01Icon as unknown as IconSvgElement} size={18} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="reply-all" size={18} color={colors.icon} />
          )}
          <Text style={[styles.replyButtonText, { color: colors.text }]}>Reply All</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.replyButton, { borderColor: colors.border }]}
          onPress={handleForward}
          activeOpacity={0.7}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon icon={Forward01Icon as unknown as IconSvgElement} size={18} color={colors.icon} />
          ) : (
            <MaterialCommunityIcons name="share" size={18} color={colors.icon} />
          )}
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
  moreMenuAnchor: {
    position: 'relative',
  },
  menuBackdrop: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99,
  },
  moreMenu: {
    position: 'absolute',
    top: 44,
    right: 0,
    minWidth: 180,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.15)' } as any,
      default: { elevation: 8 },
    }),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  menuItemText: {
    fontSize: 13,
    fontWeight: '500',
  },
  labelPicker: {
    position: 'absolute',
    top: 56,
    right: 16,
    minWidth: 200,
    maxWidth: 280,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    zIndex: 100,
    ...Platform.select({
      web: { boxShadow: '0 4px 16px rgba(0,0,0,0.15)' } as any,
      default: { elevation: 8 },
    }),
  },
  labelPickerTitle: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  labelPickerEmpty: {
    fontSize: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  labelPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 10,
  },
  labelPickerItemText: {
    fontSize: 13,
    flex: 1,
  },
  labelDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
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
    marginBottom: 8,
  },
  labelChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  labelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  labelChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  labelChipText: {
    fontSize: 11,
    fontWeight: '500',
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
  senderDetails: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  detailRow: {
    flexDirection: 'row',
    gap: 8,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: '600',
    width: 40,
  },
  detailValue: {
    fontSize: 12,
    flex: 1,
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
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  replyButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  replyButtonText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
