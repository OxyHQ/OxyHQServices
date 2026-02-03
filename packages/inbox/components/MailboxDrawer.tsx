/**
 * Gmail-style drawer sidebar listing mailboxes.
 */

import React, { useMemo, useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy } from '@oxyhq/services';
import { useRouter } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { Avatar } from '@/components/Avatar';
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
  const { user, logout } = useOxy();
  const router = useRouter();
  const [menuVisible, setMenuVisible] = useState(false);

  const handleOpenMenu = useCallback(() => {
    setMenuVisible((v) => !v);
  }, []);

  const handleMenuItem = useCallback(
    (action: string) => {
      setMenuVisible(false);
      switch (action) {
        case 'settings':
          router.push('/settings');
          onClose?.();
          break;
        case 'logout':
          logout();
          break;
      }
    },
    [router, logout, onClose],
  );

  const currentMailbox = useEmailStore((s) => s.currentMailbox);
  const selectMailbox = useEmailStore((s) => s.selectMailbox);
  const { data: mailboxes = [] } = useMailboxes();

  // Auto-select inbox on first load
  useEffect(() => {
    if (mailboxes.length > 0 && !currentMailbox) {
      const inbox = mailboxes.find((m) => m.specialUse === 'Inbox') ?? mailboxes[0];
      selectMailbox(inbox);
    }
  }, [mailboxes, currentMailbox, selectMailbox]);

  const systemMailboxes = mailboxes.filter((m) => m.specialUse);
  const customMailboxes = mailboxes.filter((m) => !m.specialUse);

  const handleSelect = (mailbox: Mailbox) => {
    selectMailbox(mailbox);
    onClose?.();
  };

  const emailAddress = user?.username ? `${user.username}@oxy.so` : '';
  const displayName = user?.name?.first
    ? `${user.name.first}${user.name.last ? ` ${user.name.last}` : ''}`
    : user?.username || 'Account';

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

      {/* Account section at bottom — wrapper for button + inline popover */}
      <View style={styles.footerWrapper}>
        {/* Popover menu — rendered inline, positioned above the button */}
        {menuVisible && (
          <>
            <Pressable style={styles.menuBackdrop} onPress={() => setMenuVisible(false)} />
            <View
              style={[
                styles.menuContainer,
                {
                  backgroundColor: colors.surface,
                  borderColor: colors.border,
                  ...Platform.select({
                    web: { boxShadow: '0 4px 24px rgba(0,0,0,0.18)' } as any,
                    default: {},
                  }),
                },
              ]}
            >
              {/* User info header */}
              <View style={[styles.menuHeader, { borderBottomColor: colors.border }]}>
                <Avatar name={user?.name?.first || user?.username || '?'} size={36} />
                <View style={styles.menuHeaderInfo}>
                  <Text style={[styles.menuHeaderName, { color: colors.text }]} numberOfLines={1}>
                    {displayName}
                  </Text>
                  <Text style={[styles.menuHeaderEmail, { color: colors.secondaryText }]} numberOfLines={1}>
                    {emailAddress}
                  </Text>
                </View>
              </View>

              {/* Menu items */}
              <View style={styles.menuItems}>
                <TouchableOpacity style={styles.menuItem} onPress={() => handleMenuItem('settings')} activeOpacity={0.6}>
                  <MaterialCommunityIcons name="cog-outline" size={18} color={colors.icon} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Settings</Text>
                </TouchableOpacity>
                <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                <TouchableOpacity style={styles.menuItem} onPress={() => handleMenuItem('logout')} activeOpacity={0.6}>
                  <MaterialCommunityIcons name="logout" size={18} color={colors.icon} />
                  <Text style={[styles.menuItemText, { color: colors.text }]}>Log out</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* Account button */}
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={styles.accountButton}
            onPress={handleOpenMenu}
            activeOpacity={0.7}
          >
            <Avatar name={user?.name?.first || user?.username || '?'} size={32} />
            <View style={styles.accountInfo}>
              <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={[styles.accountEmail, { color: colors.secondaryText }]} numberOfLines={1}>
                {emailAddress}
              </Text>
            </View>
            <MaterialCommunityIcons name="unfold-more-horizontal" size={18} color={colors.secondaryText} />
          </TouchableOpacity>
        </View>
      </View>
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
  footerWrapper: {
    position: 'relative',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  accountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    gap: 10,
  },
  accountInfo: {
    flex: 1,
    minWidth: 0,
  },
  accountName: {
    fontSize: 13,
    fontWeight: '600',
  },
  accountEmail: {
    fontSize: 11,
    marginTop: 1,
  },
  menuBackdrop: {
    position: 'fixed' as any,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 99,
  },
  menuContainer: {
    position: 'absolute',
    bottom: '100%',
    left: 8,
    right: 8,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    zIndex: 100,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  menuHeaderInfo: {
    flex: 1,
    minWidth: 0,
  },
  menuHeaderName: {
    fontSize: 13,
    fontWeight: '600',
  },
  menuHeaderEmail: {
    fontSize: 11,
    marginTop: 1,
  },
  menuItems: {
    paddingVertical: 4,
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
  menuDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 14,
    marginVertical: 2,
  },
});
