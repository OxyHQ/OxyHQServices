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
import { useRouter, usePathname } from 'expo-router';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Home01Icon,
  FavouriteIcon,
  InboxIcon,
  SentIcon,
  NoteEditIcon,
  Delete01Icon,
  SpamIcon,
  Archive01Icon,
  StarIcon as HugeStarIcon,
  Folder01Icon,
  LabelIcon,
  Settings01Icon,
  Logout01Icon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
} from '@hugeicons/core-free-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useEmailStore } from '@/hooks/useEmail';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { Avatar } from '@/components/Avatar';
import type { Mailbox } from '@/services/emailApi';

const MAILBOX_ICONS_FALLBACK: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Inbox: 'inbox',
  Sent: 'send',
  Drafts: 'file-document-edit-outline',
  Trash: 'delete-outline',
  Spam: 'alert-octagon-outline',
  Archive: 'archive-outline',
  Starred: 'star-outline',
};

const MAILBOX_HUGE_ICONS: Record<string, IconSvgElement> = {
  Inbox: InboxIcon as unknown as IconSvgElement,
  Sent: SentIcon as unknown as IconSvgElement,
  Drafts: NoteEditIcon as unknown as IconSvgElement,
  Trash: Delete01Icon as unknown as IconSvgElement,
  Spam: SpamIcon as unknown as IconSvgElement,
  Archive: Archive01Icon as unknown as IconSvgElement,
  Starred: HugeStarIcon as unknown as IconSvgElement,
};

function getMailboxFallbackIcon(mailbox: Mailbox): keyof typeof MaterialCommunityIcons.glyphMap {
  if (mailbox.specialUse && MAILBOX_ICONS_FALLBACK[mailbox.specialUse]) {
    return MAILBOX_ICONS_FALLBACK[mailbox.specialUse];
  }
  return 'folder-outline';
}

function getMailboxHugeIcon(mailbox: Mailbox): IconSvgElement {
  if (mailbox.specialUse && MAILBOX_HUGE_ICONS[mailbox.specialUse]) {
    return MAILBOX_HUGE_ICONS[mailbox.specialUse];
  }
  return Folder01Icon as unknown as IconSvgElement;
}

function NavItem({
  icon,
  hugeIcon,
  label,
  isActive,
  colors,
  badge,
  collapsed,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  hugeIcon: IconSvgElement;
  label: string;
  isActive: boolean;
  colors: (typeof Colors)['light'];
  badge?: number;
  collapsed?: boolean;
  onPress: () => void;
}) {
  const iconColor = isActive ? colors.sidebarItemActiveText : colors.icon;
  return (
    <TouchableOpacity
      style={[
        styles.item,
        isActive && { backgroundColor: colors.sidebarItemActive },
        collapsed && styles.itemCollapsed,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {Platform.OS === 'web' ? (
        <HugeiconsIcon icon={hugeIcon} size={20} color={iconColor} strokeWidth={2} />
      ) : (
        <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
      )}
      {!collapsed && (
        <>
          <Text
            style={[
              styles.itemLabel,
              { color: isActive ? colors.sidebarItemActiveText : colors.sidebarText },
              isActive && styles.itemLabelActive,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {badge != null && badge > 0 && (
            <Text
              style={[
                styles.badge,
                { color: isActive ? colors.sidebarItemActiveText : colors.secondaryText },
              ]}
            >
              {badge}
            </Text>
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

export function MailboxDrawer({ onClose, onToggle, collapsed }: { onClose?: () => void; onToggle?: () => void; collapsed?: boolean }) {
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

  const pathname = usePathname();
  const currentMailbox = useEmailStore((s) => s.currentMailbox);
  const selectMailbox = useEmailStore((s) => s.selectMailbox);
  const { data: mailboxes = [] } = useMailboxes();
  const isHomeActive = pathname === '/home';
  const isForYouActive = pathname === '/for-you';
  const isSpecialPage = isHomeActive || isForYouActive;

  // Auto-select inbox on first load
  useEffect(() => {
    console.log('[MailboxDrawer] mailboxes:', mailboxes.length, 'currentMailbox:', !!currentMailbox);
    if (mailboxes.length > 0) {
      console.log('[MailboxDrawer] First mailbox specialUse:', mailboxes[0].specialUse);
    }
    if (mailboxes.length > 0 && !currentMailbox) {
      // specialUse comes from backend with backslash prefix like \\Inbox, \\Sent, etc.
      const inbox = mailboxes.find((m) => m.specialUse === '\\Inbox') ?? mailboxes[0];
      console.log('[MailboxDrawer] Auto-selecting inbox:', inbox.name, 'specialUse:', inbox.specialUse);
      selectMailbox(inbox);
    }
  }, [mailboxes, currentMailbox, selectMailbox]);

  const systemMailboxes = mailboxes.filter((m) => m.specialUse);
  const customMailboxes = mailboxes.filter((m) => !m.specialUse);

  const handleSelect = (mailbox: Mailbox) => {
    selectMailbox(mailbox);
    if (isSpecialPage) {
      router.replace('/');
    }
    onClose?.();
  };

  const handleHome = () => {
    router.push('/home');
    onClose?.();
  };

  const handleForYou = () => {
    router.push('/for-you');
    onClose?.();
  };

  const emailAddress = user?.username ? `${user.username}@oxy.so` : '';
  const displayName = user?.name?.first
    ? `${user.name.first}${user.name.last ? ` ${user.name.last}` : ''}`
    : user?.username || 'Account';

  return (
    <View style={[styles.container, { backgroundColor: colors.sidebarBackground }, collapsed && styles.containerCollapsed]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }, collapsed && styles.headerCollapsed]}>
        {collapsed ? (
          <TouchableOpacity onPress={onToggle} style={styles.collapseButtonCenter} activeOpacity={0.7}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={SidebarRight01Icon as unknown as IconSvgElement} size={20} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="dock-right" size={20} color={colors.icon} />
            )}
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={[styles.appTitle, { color: colors.primary }]}>Inbox</Text>
              {onToggle && (
                <TouchableOpacity onPress={onToggle} style={styles.collapseButton} activeOpacity={0.7}>
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon icon={SidebarLeft01Icon as unknown as IconSvgElement} size={20} color={colors.icon} />
                  ) : (
                    <MaterialCommunityIcons name="dock-left" size={20} color={colors.icon} />
                  )}
                </TouchableOpacity>
              )}
            </View>
            <Text style={[styles.email, { color: colors.secondaryText }]}>{emailAddress}</Text>
          </>
        )}
      </View>

      <ScrollView style={[styles.list, collapsed && styles.listCollapsed]} showsVerticalScrollIndicator={false}>
        <NavItem icon="home-outline" hugeIcon={Home01Icon as unknown as IconSvgElement} label="Home" isActive={isHomeActive} colors={colors} collapsed={collapsed} onPress={handleHome} />
        <NavItem icon="cards-heart-outline" hugeIcon={FavouriteIcon as unknown as IconSvgElement} label="For You" isActive={isForYouActive} colors={colors} collapsed={collapsed} onPress={handleForYou} />

        {/* System Mailboxes */}
        {systemMailboxes.map((mailbox) => (
          <NavItem
            key={mailbox._id}
            icon={getMailboxFallbackIcon(mailbox)}
            hugeIcon={getMailboxHugeIcon(mailbox)}
            label={mailbox.specialUse || mailbox.name}
            isActive={!isSpecialPage && currentMailbox?._id === mailbox._id}
            colors={colors}
            badge={mailbox.unseenMessages}
            collapsed={collapsed}
            onPress={() => handleSelect(mailbox)}
          />
        ))}

        {/* Custom Labels */}
        {!collapsed && customMailboxes.length > 0 && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Labels</Text>
            {customMailboxes.map((mailbox) => (
              <NavItem
                key={mailbox._id}
                icon="label-outline"
                hugeIcon={LabelIcon as unknown as IconSvgElement}
                label={mailbox.name}
                isActive={!isSpecialPage && currentMailbox?._id === mailbox._id}
                colors={colors}
                onPress={() => handleSelect(mailbox)}
              />
            ))}
          </>
        )}
        {collapsed && customMailboxes.length > 0 && (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            {customMailboxes.map((mailbox) => (
              <NavItem
                key={mailbox._id}
                icon="label-outline"
                hugeIcon={LabelIcon as unknown as IconSvgElement}
                label={mailbox.name}
                isActive={!isSpecialPage && currentMailbox?._id === mailbox._id}
                colors={colors}
                collapsed
                onPress={() => handleSelect(mailbox)}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* Account section at bottom */}
      {!collapsed && (
        <View style={styles.footerWrapper}>
          {/* Popover menu */}
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
                    {Platform.OS === 'web' ? (
                      <HugeiconsIcon icon={Settings01Icon as unknown as IconSvgElement} size={18} color={colors.icon} />
                    ) : (
                      <MaterialCommunityIcons name="cog-outline" size={18} color={colors.icon} />
                    )}
                    <Text style={[styles.menuItemText, { color: colors.text }]}>Settings</Text>
                  </TouchableOpacity>
                  <View style={[styles.menuDivider, { backgroundColor: colors.border }]} />
                  <TouchableOpacity style={styles.menuItem} onPress={() => handleMenuItem('logout')} activeOpacity={0.6}>
                    {Platform.OS === 'web' ? (
                      <HugeiconsIcon icon={Logout01Icon as unknown as IconSvgElement} size={18} color={colors.icon} />
                    ) : (
                      <MaterialCommunityIcons name="logout" size={18} color={colors.icon} />
                    )}
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
      )}

      {/* Collapsed footer — just avatar */}
      {collapsed && (
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={styles.collapsedAccountButton}
            onPress={handleOpenMenu}
            activeOpacity={0.7}
          >
            <Avatar name={user?.name?.first || user?.username || '?'} size={32} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 48,
  },
  containerCollapsed: {
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: 4,
  },
  headerCollapsed: {
    paddingHorizontal: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 2,
  },
  collapseButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  collapseButtonCenter: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  email: {
    fontSize: 12,
  },
  list: {
    flex: 1,
    paddingHorizontal: 8,
  },
  listCollapsed: {
    paddingHorizontal: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 28,
    marginVertical: 1,
    gap: 12,
  },
  itemCollapsed: {
    justifyContent: 'center',
    padding: 10,
    borderRadius: 12,
    gap: 0,
  },
  itemLabel: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  itemLabelActive: {
    fontWeight: '700',
  },
  badge: {
    fontSize: 11,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
    marginHorizontal: 14,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingVertical: 6,
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
  collapsedAccountButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
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
