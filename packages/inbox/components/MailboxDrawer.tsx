/**
 * Gmail-style drawer sidebar listing mailboxes, starred, labels, and compose.
 */

import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  TextInput,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useOxy, showSignInModal } from '@oxyhq/services';
import { useRouter, usePathname } from 'expo-router';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Badge } from '@oxyhq/bloom/badge';
import * as Prompt from '@oxyhq/bloom/prompt';
import * as Dialog from '@oxyhq/bloom/dialog';
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
  FolderAddIcon,
  LabelIcon,
  SidebarLeft01Icon,
  SidebarRight01Icon,
  PencilEdit01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Mail01Icon,
  Clock01Icon,
  Cancel01Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons';
import { useColors } from '@/constants/theme';
import { Divider } from '@oxyhq/bloom/divider';
import { SPECIAL_USE } from '@/constants/mailbox';
import { useEmailStore } from '@/hooks/useEmail';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useLabels } from '@/hooks/queries/useLabels';
import { Avatar } from '@/components/Avatar';
import type { Mailbox } from '@/services/emailApi';
import { useCreateMailbox, useDeleteMailbox } from '@/hooks/mutations/useMailboxMutations';
import { LogoIcon } from '@/assets/logo';
import { AccountSwitcher } from '@/components/AccountSwitcher';

const MAILBOX_ICONS_FALLBACK: Record<string, keyof typeof MaterialCommunityIcons.glyphMap> = {
  Inbox: 'inbox',
  Sent: 'send',
  Drafts: 'file-document-edit-outline',
  Trash: 'delete-outline',
  Spam: 'alert-octagon-outline',
  Archive: 'archive-outline',
  Starred: 'star-outline',
  Snoozed: 'clock-outline',
};

const MAILBOX_HUGE_ICONS: Record<string, IconSvgElement> = {
  Inbox: InboxIcon as unknown as IconSvgElement,
  Sent: SentIcon as unknown as IconSvgElement,
  Drafts: NoteEditIcon as unknown as IconSvgElement,
  Trash: Delete01Icon as unknown as IconSvgElement,
  Spam: SpamIcon as unknown as IconSvgElement,
  Archive: Archive01Icon as unknown as IconSvgElement,
  Starred: HugeStarIcon as unknown as IconSvgElement,
  Snoozed: Clock01Icon as unknown as IconSvgElement,
};

// Primary mailboxes shown by default; the rest go behind "More"
const PRIMARY_SPECIAL_USE: Set<string> = new Set([SPECIAL_USE.INBOX, SPECIAL_USE.SENT, SPECIAL_USE.DRAFTS]);

function getMailboxFallbackIcon(mailbox: Mailbox): keyof typeof MaterialCommunityIcons.glyphMap {
  if (mailbox.specialUse) {
    const normalized = mailbox.specialUse.replace(/^\\+/, '');
    if (MAILBOX_ICONS_FALLBACK[normalized]) {
      return MAILBOX_ICONS_FALLBACK[normalized];
    }
  }
  return 'folder-outline';
}

function getMailboxHugeIcon(mailbox: Mailbox): IconSvgElement {
  if (mailbox.specialUse) {
    const normalized = mailbox.specialUse.replace(/^\\+/, '');
    if (MAILBOX_HUGE_ICONS[normalized]) {
      return MAILBOX_HUGE_ICONS[normalized];
    }
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
  bold,
  colorDot,
  onPress,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  hugeIcon: IconSvgElement;
  label: string;
  isActive: boolean;
  colors: ReturnType<typeof useColors>;
  badge?: number;
  collapsed?: boolean;
  bold?: boolean;
  colorDot?: string;
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
      {colorDot ? (
        <View style={[styles.colorDot, { backgroundColor: colorDot }]} />
      ) : Platform.OS === 'web' ? (
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
              (isActive || bold) && styles.itemLabelActive,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
          {badge != null && badge > 0 && (
            <Badge variant="subtle" color="default" content={badge} size="small" />
          )}
        </>
      )}
    </TouchableOpacity>
  );
}

export function MailboxDrawer({ onClose, onToggle, collapsed }: { onClose?: () => void; onToggle?: () => void; collapsed?: boolean }) {
  const colors = useColors();
  const { user } = useOxy();
  const router = useRouter();
  const accountSwitcherControl = Dialog.useDialogControl();
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [deletingMailboxId, setDeletingMailboxId] = useState<string | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<Mailbox | null>(null);
  const deleteFolderPrompt = Prompt.usePromptControl();
  const newFolderInputRef = useRef<TextInput>(null);
  const createMailbox = useCreateMailbox();
  const deleteMailbox = useDeleteMailbox();

  const handleOpenMenu = useCallback(() => {
    accountSwitcherControl.open();
  }, [accountSwitcherControl]);

  const handleAddAccount = useCallback(() => {
    accountSwitcherControl.close();
    // Open the sign-in modal to authenticate a new account.
    // Once authenticated, OxyContext will add the new session, and
    // the useAccountSwitcher hook will persist it to account storage.
    showSignInModal();
  }, [accountSwitcherControl]);

  const pathname = usePathname();
  const moreExpanded = useEmailStore((s) => s.moreExpanded);
  const toggleMore = useEmailStore((s) => s.toggleMore);
  const { data: mailboxes = [] } = useMailboxes();
  const { data: labels = [] } = useLabels();

  // Determine active state from URL pathname
  const isHomeActive = pathname === '/home';
  const isForYouActive = pathname === '/for-you';
  const currentView = pathname.split('/')[1]?.toLowerCase() || 'inbox';

  const { primaryMailboxes, snoozedMailbox, secondaryMailboxes } = useMemo(() => {
    const order: Record<string, number> = {
      [SPECIAL_USE.INBOX]: 0, [SPECIAL_USE.SENT]: 1, [SPECIAL_USE.DRAFTS]: 2,
      [SPECIAL_USE.SNOOZED]: 3, [SPECIAL_USE.SPAM]: 4, [SPECIAL_USE.TRASH]: 5, [SPECIAL_USE.ARCHIVE]: 6,
    };
    const sorted = mailboxes
      .filter((m) => m.specialUse)
      .sort((a, b) => (order[a.specialUse!] ?? 99) - (order[b.specialUse!] ?? 99));

    return {
      primaryMailboxes: sorted.filter((m) => PRIMARY_SPECIAL_USE.has(m.specialUse!)),
      snoozedMailbox: sorted.find((m) => m.specialUse === SPECIAL_USE.SNOOZED) || null,
      secondaryMailboxes: sorted.filter((m) => !PRIMARY_SPECIAL_USE.has(m.specialUse!) && m.specialUse !== SPECIAL_USE.SNOOZED),
    };
  }, [mailboxes]);

  const customMailboxes = useMemo(() => mailboxes.filter((m) => !m.specialUse), [mailboxes]);

  // Map specialUse to URL route
  const getMailboxRoute = (mailbox: Mailbox): string => {
    if (!mailbox.specialUse) return `/folder-${mailbox.name.toLowerCase()}`;
    const routeMap: Record<string, string> = {
      [SPECIAL_USE.INBOX]: '/inbox',
      [SPECIAL_USE.SENT]: '/sent',
      [SPECIAL_USE.DRAFTS]: '/drafts',
      [SPECIAL_USE.TRASH]: '/trash',
      [SPECIAL_USE.SPAM]: '/spam',
      [SPECIAL_USE.ARCHIVE]: '/archive',
      [SPECIAL_USE.SNOOZED]: '/snoozed',
    };
    return routeMap[mailbox.specialUse] || `/folder-${mailbox.name.toLowerCase()}`;
  };

  const handleSelect = (mailbox: Mailbox) => {
    router.push(getMailboxRoute(mailbox) as any);
    onClose?.();
  };

  const handleStarred = () => {
    router.push('/starred' as any);
    onClose?.();
  };

  const handleLabelSelect = (labelId: string, labelName: string) => {
    router.push(`/label-${labelName.toLowerCase()}` as any);
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

  const handleCompose = () => {
    router.push('/compose');
    onClose?.();
  };

  const handleSubscriptions = () => {
    router.push('/subscriptions' as any);
    onClose?.();
  };

  const emailAddress = user?.username ? `${user.username}@oxy.so` : '';
  const displayName = user?.name?.first
    ? `${user.name.first}${user.name.last ? ` ${user.name.last}` : ''}`
    : user?.username || 'Account';

  // Check if a mailbox route is active
  const isMailboxActive = (mailbox: Mailbox): boolean => {
    if (!mailbox.specialUse) return currentView === `folder-${mailbox.name.toLowerCase()}`;
    const routeMap: Record<string, string> = {
      [SPECIAL_USE.INBOX]: 'inbox',
      [SPECIAL_USE.SENT]: 'sent',
      [SPECIAL_USE.DRAFTS]: 'drafts',
      [SPECIAL_USE.TRASH]: 'trash',
      [SPECIAL_USE.SPAM]: 'spam',
      [SPECIAL_USE.ARCHIVE]: 'archive',
      [SPECIAL_USE.SNOOZED]: 'snoozed',
    };
    return currentView === routeMap[mailbox.specialUse];
  };

  const isStarredActive = currentView === 'starred';
  const isSubscriptionsActive = currentView === 'subscriptions';

  const handleCreateFolder = useCallback(() => {
    const trimmed = newFolderName.trim();
    if (!trimmed) return;
    createMailbox.mutate(
      { name: trimmed },
      {
        onSuccess: () => {
          setNewFolderName('');
          setIsCreatingFolder(false);
        },
      },
    );
  }, [newFolderName, createMailbox]);

  const handleCancelCreate = useCallback(() => {
    setNewFolderName('');
    setIsCreatingFolder(false);
  }, []);

  const handleDeleteFolder = useCallback(
    (mailbox: Mailbox) => {
      setFolderToDelete(mailbox);
      deleteFolderPrompt.open();
    },
    [deleteFolderPrompt],
  );

  const handleConfirmDeleteFolder = useCallback(() => {
    if (folderToDelete) {
      deleteMailbox.mutate({ mailboxId: folderToDelete._id });
      setDeletingMailboxId(null);
      setFolderToDelete(null);
    }
  }, [folderToDelete, deleteMailbox]);

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
              <View style={styles.logoRow}>
                <LogoIcon height={44} color={colors.primary} />
                <Text style={[styles.appTitle, { color: colors.primary }]}>Inbox</Text>
              </View>
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

      {/* Compose button */}
      {!collapsed && (
        <View style={styles.composeWrapper}>
          <TouchableOpacity
            style={[styles.composeButton, { backgroundColor: colors.composeFab }]}
            onPress={handleCompose}
            activeOpacity={0.8}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={PencilEdit01Icon as unknown as IconSvgElement} size={20} color={colors.composeFabIcon} />
            ) : (
              <MaterialCommunityIcons name="pencil" size={20} color={colors.composeFabIcon} />
            )}
            <Text style={[styles.composeLabel, { color: colors.composeFabText }]}>Compose</Text>
          </TouchableOpacity>
        </View>
      )}
      {collapsed && (
        <View style={styles.composeWrapperCollapsed}>
          <TouchableOpacity
            style={[styles.composeButtonCollapsed, { backgroundColor: colors.composeFab }]}
            onPress={handleCompose}
            activeOpacity={0.8}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={PencilEdit01Icon as unknown as IconSvgElement} size={20} color={colors.composeFabIcon} />
            ) : (
              <MaterialCommunityIcons name="pencil" size={20} color={colors.composeFabIcon} />
            )}
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={[styles.list, collapsed && styles.listCollapsed]} showsVerticalScrollIndicator={false}>
        <NavItem icon="home-outline" hugeIcon={Home01Icon as unknown as IconSvgElement} label="Home" isActive={isHomeActive} colors={colors} collapsed={collapsed} onPress={handleHome} />
        <NavItem icon="cards-heart-outline" hugeIcon={FavouriteIcon as unknown as IconSvgElement} label="For You" isActive={isForYouActive} colors={colors} collapsed={collapsed} onPress={handleForYou} />

        {/* Primary Mailboxes (Inbox, Sent, Drafts) */}
        {primaryMailboxes.map((mailbox) => {
          const label = mailbox.specialUse ? mailbox.specialUse.replace(/^\\+/, '') : mailbox.name;
          const hasUnseen = mailbox.unseenMessages > 0;
          return (
            <NavItem
              key={mailbox._id}
              icon={getMailboxFallbackIcon(mailbox)}
              hugeIcon={getMailboxHugeIcon(mailbox)}
              label={label}
              isActive={isMailboxActive(mailbox)}
              colors={colors}
              badge={mailbox.unseenMessages}
              bold={hasUnseen}
              collapsed={collapsed}
              onPress={() => handleSelect(mailbox)}
            />
          );
        })}

        {/* Starred */}
        <NavItem
          icon="star-outline"
          hugeIcon={HugeStarIcon as unknown as IconSvgElement}
          label="Starred"
          isActive={isStarredActive}
          colors={colors}
          collapsed={collapsed}
          onPress={handleStarred}
        />

        {/* Snoozed */}
        {snoozedMailbox && (
          <NavItem
            icon="clock-outline"
            hugeIcon={Clock01Icon as unknown as IconSvgElement}
            label="Snoozed"
            isActive={isMailboxActive(snoozedMailbox)}
            colors={colors}
            badge={snoozedMailbox.unseenMessages}
            collapsed={collapsed}
            onPress={() => handleSelect(snoozedMailbox)}
          />
        )}

        {/* Subscriptions */}
        <NavItem
          icon="newspaper-variant-outline"
          hugeIcon={Mail01Icon as unknown as IconSvgElement}
          label="Subscriptions"
          isActive={isSubscriptionsActive}
          colors={colors}
          collapsed={collapsed}
          onPress={handleSubscriptions}
        />

        {/* More toggle for secondary mailboxes */}
        {secondaryMailboxes.length > 0 && !collapsed && (
          <TouchableOpacity style={styles.moreToggle} onPress={toggleMore} activeOpacity={0.7}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon
                icon={(moreExpanded ? ArrowUp01Icon : ArrowDown01Icon) as unknown as IconSvgElement}
                size={16}
                color={colors.secondaryText}
              />
            ) : (
              <MaterialCommunityIcons
                name={moreExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.secondaryText}
              />
            )}
            <Text style={[styles.moreToggleText, { color: colors.secondaryText }]}>
              {moreExpanded ? 'Less' : 'More'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Secondary Mailboxes (Spam, Trash, Archive) - behind "More" */}
        {(moreExpanded || collapsed) && secondaryMailboxes.map((mailbox) => {
          const label = mailbox.specialUse ? mailbox.specialUse.replace(/^\\+/, '') : mailbox.name;
          return (
            <NavItem
              key={mailbox._id}
              icon={getMailboxFallbackIcon(mailbox)}
              hugeIcon={getMailboxHugeIcon(mailbox)}
              label={label}
              isActive={isMailboxActive(mailbox)}
              colors={colors}
              badge={mailbox.unseenMessages}
              collapsed={collapsed}
              onPress={() => handleSelect(mailbox)}
            />
          );
        })}

        {/* Labels (from Label model, not custom mailboxes) */}
        {!collapsed && labels.length > 0 && (
          <>
            <Divider />
            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Labels</Text>
            {labels.map((lbl) => (
              <NavItem
                key={lbl._id}
                icon="label-outline"
                hugeIcon={LabelIcon as unknown as IconSvgElement}
                label={lbl.name}
                isActive={currentView === `label-${lbl.name.toLowerCase()}`}
                colors={colors}
                colorDot={lbl.color}
                collapsed={collapsed}
                onPress={() => handleLabelSelect(lbl._id, lbl.name)}
              />
            ))}
          </>
        )}
        {/* Labels hidden when collapsed for cleaner UI */}

        {/* Custom mailboxes (non-system, non-label) */}
        {!collapsed && (
          <>
            {(customMailboxes.length > 0 || isCreatingFolder) && (
              <Divider />
            )}
            {(customMailboxes.length > 0 || isCreatingFolder) && (
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>Folders</Text>
              </View>
            )}
            {customMailboxes.map((mailbox) => (
              <View key={mailbox._id} style={styles.customMailboxRow}>
                <View style={styles.customMailboxNav}>
                  <NavItem
                    icon="folder-outline"
                    hugeIcon={Folder01Icon as unknown as IconSvgElement}
                    label={mailbox.name}
                    isActive={isMailboxActive(mailbox)}
                    colors={colors}
                    collapsed={collapsed}
                    onPress={() => handleSelect(mailbox)}
                  />
                </View>
                {deletingMailboxId === mailbox._id ? (
                  <View style={styles.deleteActions}>
                    <TouchableOpacity
                      style={styles.deleteConfirmButton}
                      onPress={() => handleDeleteFolder(mailbox)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.deleteConfirmText, { color: colors.danger }]}>Delete</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.deleteCancelButton}
                      onPress={() => setDeletingMailboxId(null)}
                      activeOpacity={0.7}
                    >
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={16} color={colors.secondaryText} />
                      ) : (
                        <MaterialCommunityIcons name="close" size={16} color={colors.secondaryText} />
                      )}
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    style={styles.deleteIconButton}
                    onPress={() => setDeletingMailboxId(mailbox._id)}
                    activeOpacity={0.7}
                  >
                    {Platform.OS === 'web' ? (
                      <HugeiconsIcon icon={Delete01Icon as unknown as IconSvgElement} size={14} color={colors.secondaryText} />
                    ) : (
                      <MaterialCommunityIcons name="delete-outline" size={14} color={colors.secondaryText} />
                    )}
                  </TouchableOpacity>
                )}
              </View>
            ))}

            {/* Inline create folder input */}
            {isCreatingFolder && (
              <View style={styles.createFolderRow}>
                <View style={styles.createFolderInputWrapper}>
                  {Platform.OS === 'web' ? (
                    <HugeiconsIcon icon={Folder01Icon as unknown as IconSvgElement} size={18} color={colors.secondaryText} />
                  ) : (
                    <MaterialCommunityIcons name="folder-outline" size={18} color={colors.secondaryText} />
                  )}
                  <TextInput
                    ref={newFolderInputRef}
                    style={[styles.createFolderInput, { color: colors.text, borderColor: colors.border }]}
                    placeholder="Folder name"
                    placeholderTextColor={colors.secondaryText}
                    value={newFolderName}
                    onChangeText={setNewFolderName}
                    onSubmitEditing={handleCreateFolder}
                    autoFocus
                    returnKeyType="done"
                  />
                </View>
                <View style={styles.createFolderActions}>
                  <TouchableOpacity
                    style={[styles.createFolderConfirm, { opacity: newFolderName.trim() ? 1 : 0.4 }]}
                    onPress={handleCreateFolder}
                    disabled={!newFolderName.trim() || createMailbox.isPending}
                    activeOpacity={0.7}
                  >
                    {Platform.OS === 'web' ? (
                      <HugeiconsIcon icon={Tick02Icon as unknown as IconSvgElement} size={16} color={colors.primary} />
                    ) : (
                      <MaterialCommunityIcons name="check" size={16} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.createFolderCancel}
                    onPress={handleCancelCreate}
                    activeOpacity={0.7}
                  >
                    {Platform.OS === 'web' ? (
                      <HugeiconsIcon icon={Cancel01Icon as unknown as IconSvgElement} size={16} color={colors.secondaryText} />
                    ) : (
                      <MaterialCommunityIcons name="close" size={16} color={colors.secondaryText} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Create folder button */}
            {!isCreatingFolder && (
              <TouchableOpacity
                style={styles.createFolderButton}
                onPress={() => setIsCreatingFolder(true)}
                activeOpacity={0.7}
              >
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={FolderAddIcon as unknown as IconSvgElement} size={18} color={colors.secondaryText} />
                ) : (
                  <MaterialCommunityIcons name="folder-plus-outline" size={18} color={colors.secondaryText} />
                )}
                <Text style={[styles.createFolderLabel, { color: colors.secondaryText }]}>Create folder</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      {/* Account section at bottom */}
      {!collapsed && (
        <View style={styles.footerWrapper}>
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

      {/* Account switcher dialog */}
      <Dialog.Outer control={accountSwitcherControl}>
        <Dialog.Handle />
        <Dialog.Inner label="Account Switcher">
          <AccountSwitcher
            onClose={() => accountSwitcherControl.close()}
            onSettings={() => {
              accountSwitcherControl.close();
              router.push('/settings');
              onClose?.();
            }}
            onAddAccount={handleAddAccount}
          />
        </Dialog.Inner>
      </Dialog.Outer>

      {/* Delete folder confirmation */}
      <Prompt.Basic
        control={deleteFolderPrompt}
        title="Delete folder?"
        description={`Delete "${folderToDelete?.name ?? ''}"? Messages in this folder will be moved to Trash.`}
        confirmButtonCta="Delete"
        confirmButtonColor="negative"
        onConfirm={handleConfirmDeleteFolder}
      />
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
  logoRow: {
    alignItems: 'flex-start',
    gap: 4,
  },
  appTitle: {
    fontSize: 24,
    fontWeight: '800',
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
  composeWrapper: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  composeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 24,
    gap: 10,
  },
  composeLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  composeWrapperCollapsed: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  composeButtonCollapsed: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    gap: 8,
  },
  moreToggleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingVertical: 6,
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: 8,
  },
  customMailboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  customMailboxNav: {
    flex: 1,
    minWidth: 0,
  },
  deleteIconButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    marginRight: 4,
    opacity: 0,
    ...Platform.select({
      web: {
        // Show on hover of parent row via CSS — fallback: always visible
        opacity: 0.5,
        // @ts-expect-error — web-only
        transition: 'opacity 0.15s',
      } as any,
      default: { opacity: 0.6 },
    }),
  },
  deleteActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginRight: 4,
  },
  deleteConfirmButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  deleteConfirmText: {
    fontSize: 11,
    fontWeight: '600',
  },
  deleteCancelButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
  },
  createFolderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 28,
    marginVertical: 1,
    gap: 12,
  },
  createFolderLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  createFolderRow: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 6,
  },
  createFolderInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  createFolderInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    ...Platform.select({
      web: { outlineStyle: 'none' } as any,
      default: {},
    }),
  },
  createFolderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  createFolderConfirm: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
  },
  createFolderCancel: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
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
});
