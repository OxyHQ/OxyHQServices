/**
 * Gmail-style drawer sidebar listing mailboxes.
 */

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import type { Mailbox } from '@/services/emailApi';

const MAILBOX_ICONS: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Inbox: 'inbox',
  Sent: 'send',
  Drafts: 'file-document-edit-outline',
  Trash: 'delete-outline',
  Spam: 'alert-octagon-outline',
  Archive: 'archive-outline',
  Starred: 'star-outline',
};

function getMailboxIcon(mailbox: Mailbox): keyof typeof MaterialCommunityIcons.glyphMap {
  if (mailbox.specialUse && MAILBOX_ICONS[mailbox.specialUse]) {
    return MAILBOX_ICONS[mailbox.specialUse];
  }
  return 'folder-outline';
}

export function MailboxDrawer({ onClose }: { onClose?: () => void }) {
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { user, oxyServices } = useOxy();
  const { mailboxes, currentMailbox, selectMailbox } = useEmailStore();

  const systemMailboxes = mailboxes.filter((m) => m.specialUse);
  const customMailboxes = mailboxes.filter((m) => !m.specialUse);

  const handleSelect = async (mailbox: Mailbox) => {
    try {
      const token = oxyServices.httpService.getAccessToken();
      if (token) {
        await selectMailbox(mailbox, token);
      }
    } catch {}
    onClose?.();
  };

  const emailAddress = user?.username ? `${user.username}@oxy.so` : '';

  return (
    <View style={[styles.container, { backgroundColor: colors.sidebarBackground }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.appTitle, { color: colors.primary }]}>Inbox</Text>
        <Text style={[styles.email, { color: colors.secondaryText }]}>{emailAddress}</Text>
      </View>

      <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
        {/* System Mailboxes */}
        {systemMailboxes.map((mailbox) => {
          const isActive = currentMailbox?._id === mailbox._id;
          return (
            <TouchableOpacity
              key={mailbox._id}
              style={[
                styles.item,
                isActive && { backgroundColor: colors.sidebarItemActive },
              ]}
              onPress={() => handleSelect(mailbox)}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name={getMailboxIcon(mailbox)}
                size={22}
                color={isActive ? colors.sidebarItemActiveText : colors.icon}
              />
              <Text
                style={[
                  styles.itemLabel,
                  { color: isActive ? colors.sidebarItemActiveText : colors.sidebarText },
                  isActive && styles.itemLabelActive,
                ]}
                numberOfLines={1}
              >
                {mailbox.specialUse || mailbox.name}
              </Text>
              {mailbox.unseenMessages > 0 && (
                <Text
                  style={[
                    styles.badge,
                    { color: isActive ? colors.sidebarItemActiveText : colors.secondaryText },
                  ]}
                >
                  {mailbox.unseenMessages}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}

        {/* Divider */}
        {customMailboxes.length > 0 && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Labels</Text>
            {customMailboxes.map((mailbox) => {
              const isActive = currentMailbox?._id === mailbox._id;
              return (
                <TouchableOpacity
                  key={mailbox._id}
                  style={[
                    styles.item,
                    isActive && { backgroundColor: colors.sidebarItemActive },
                  ]}
                  onPress={() => handleSelect(mailbox)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name="label-outline"
                    size={22}
                    color={isActive ? colors.sidebarItemActiveText : colors.icon}
                  />
                  <Text
                    style={[
                      styles.itemLabel,
                      { color: isActive ? colors.sidebarItemActiveText : colors.sidebarText },
                    ]}
                    numberOfLines={1}
                  >
                    {mailbox.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 48,
  },
  header: {
    paddingHorizontal: 24,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  appTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  email: {
    fontSize: 13,
  },
  list: {
    flex: 1,
    paddingHorizontal: 8,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 28,
    marginVertical: 1,
    gap: 16,
  },
  itemLabel: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  itemLabelActive: {
    fontWeight: '700',
  },
  badge: {
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
    marginHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    paddingVertical: 8,
    letterSpacing: 0.5,
  },
});
