import React, { useCallback } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Avatar } from '@oxyhq/services';
import type { AccountNode, AccountRole, OxyServices } from '@oxyhq/core';
import { getAccountFallbackHandle, getAccountDisplayName } from '@oxyhq/core';
import { useColors, type AppColors } from '@/hooks/useColors';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';

// Roles whose membership carries the `account:act_as` capability — the only
// roles that can SWITCH INTO the account (selecting it makes the whole app
// become that account). Mirrors the account role set (owner/admin/editor).
const SWITCHABLE_ROLES: readonly AccountRole[] = ['owner', 'admin', 'editor'];
// Roles that may manage membership + sharing of the account.
const MANAGE_MEMBER_ROLES: readonly AccountRole[] = ['owner', 'admin'];
// Roles that may edit the account's profile.
const EDIT_ROLES: readonly AccountRole[] = ['owner', 'admin', 'editor'];

function getRoleBadgeColor(role: AccountRole, colors: AppColors): string {
  switch (role) {
    case 'owner':
      return colors.sidebarIconPersonalInfo;
    case 'admin':
      return colors.sidebarIconSecurity;
    case 'editor':
      return colors.sidebarIconPayments;
    case 'developer':
      return colors.sidebarIconData;
    case 'billing':
      return colors.sidebarIconStorage;
    default:
      return colors.icon;
  }
}

/**
 * The caller's effective role on a node. Prefer the resolved membership role;
 * fall back to the relationship (an owned/`self` account is implicitly owned,
 * a shared account with no membership row defaults to read-only `viewer`).
 */
function getNodeRole(node: AccountNode): AccountRole {
  if (node.callerMembership?.role) return node.callerMembership.role;
  return node.relationship === 'member' ? 'viewer' : 'owner';
}

interface AccountRowContentProps {
  node: AccountNode;
  isCurrent: boolean;
  isArchiving: boolean;
  onSwitchTo: (accountId: string) => void;
  onManageMembers: (accountId: string) => void;
  onEditProfile: (accountId: string) => void;
  onArchive: (node: AccountNode) => void;
}

/**
 * Trailing content for a managed-account row: the role badge plus the
 * permission-gated action buttons (switch-into / manage-members / edit / archive),
 * a "current account" checkmark when active, or an archiving spinner.
 *
 * Extracted verbatim from the managed-accounts screen's `buildItem`
 * `customContent`.
 */
function AccountRowContent({
  node,
  isCurrent,
  isArchiving,
  onSwitchTo,
  onManageMembers,
  onEditProfile,
  onArchive,
}: AccountRowContentProps) {
  const colors = useColors();
  const handlePressIn = useHapticPress();
  const { t } = useTranslation();

  const role = getNodeRole(node);
  const badgeColor = getRoleBadgeColor(role, colors);
  const canSwitchInto = SWITCHABLE_ROLES.includes(role);
  const canManageMembers = MANAGE_MEMBER_ROLES.includes(role);
  const canEdit = EDIT_ROLES.includes(role);
  const canArchive = role === 'owner';

  return (
    <View style={styles.accountActions}>
      <View style={[styles.roleBadge, { backgroundColor: `${badgeColor}20`, borderColor: `${badgeColor}40` }]}>
        <Text style={[styles.roleBadgeText, { color: badgeColor }]}>{role}</Text>
      </View>
      {isArchiving ? (
        <ActivityIndicator size="small" color={colors.text} />
      ) : (
        <View style={styles.actionButtons}>
          {isCurrent ? (
            // Single "current account" indicator (Gmail-style). Not a toggle:
            // the account is already active, so there is nothing to press.
            <View
              style={styles.currentIndicator}
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('a11y.stopActingAs')}
            >
              <MaterialCommunityIcons name="check" size={20} color={colors.tint} />
            </View>
          ) : canSwitchInto ? (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPressIn={handlePressIn}
              onPress={() => onSwitchTo(node.accountId)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.actAs')}
            >
              <MaterialCommunityIcons name="swap-horizontal" size={16} color={colors.text} />
            </TouchableOpacity>
          ) : null}
          {canManageMembers && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPressIn={handlePressIn}
              onPress={() => onManageMembers(node.accountId)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.manageMembers')}
            >
              <MaterialCommunityIcons name="account-multiple-outline" size={16} color={colors.text} />
            </TouchableOpacity>
          )}
          {canEdit && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPressIn={handlePressIn}
              onPress={() => onEditProfile(node.accountId)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.editProfile')}
            >
              <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.text} />
            </TouchableOpacity>
          )}
          {canArchive && (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: colors.card }]}
              onPressIn={handlePressIn}
              onPress={() => onArchive(node)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('a11y.archiveAccount')}
            >
              <MaterialCommunityIcons name="archive-outline" size={16} color={colors.error} />
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

interface UseAccountRowBuilderParams {
  /**
   * The id of the account the app is currently signed in as (`user.id`). A real
   * session switch makes it become the switched-into account, so the "current"
   * row is simply the one whose `accountId` matches this.
   */
  currentAccountId: string | null;
  archivingId: string | null;
  oxyServices: OxyServices;
  onSwitchTo: (accountId: string) => void;
  onManageMembers: (accountId: string) => void;
  onEditProfile: (accountId: string) => void;
  onArchive: (node: AccountNode) => void;
}

/**
 * Returns a `buildItem(node)` factory that maps an `AccountNode` to a
 * `GroupedSection` row: avatar icon, display name, `@handle` subtitle (falling
 * back to a truncated `publicKey` handle), the permission-gated action content,
 * and the row-tap behavior (switch-into, else manage-members, else inert).
 *
 * Extracted verbatim from the managed-accounts screen's `buildItem`.
 */
export function useAccountRowBuilder({
  currentAccountId,
  archivingId,
  oxyServices,
  onSwitchTo,
  onManageMembers,
  onEditProfile,
  onArchive,
}: UseAccountRowBuilderParams): (node: AccountNode) => GroupedItem {
  const { t, locale } = useTranslation();

  return useCallback((node: AccountNode): GroupedItem => {
    const name = getAccountDisplayName(node.account ?? null, locale);
    const username = node.account?.username;
    // When an account has no username yet (e.g. mid-provisioning) fall back to
    // a truncated `publicKey` handle so the row still reads as identifiable
    // rather than showing "No username set".
    const fallbackHandle = getAccountFallbackHandle(node.account ?? null);
    const role = getNodeRole(node);
    // "Current" = the account the app is currently signed in as. The personal/
    // self account is not listed here.
    const isCurrent = currentAccountId === node.accountId;
    const isArchiving = archivingId === node.accountId;
    const avatarUri = node.account?.avatar
      ? oxyServices.getFileDownloadUrl(node.account.avatar, 'thumb')
      : undefined;
    const canSwitchInto = SWITCHABLE_ROLES.includes(role);
    const canManageMembers = MANAGE_MEMBER_ROLES.includes(role);

    return {
      id: node.accountId,
      title: name,
      subtitle: username
        ? `@${username}`
        : (fallbackHandle ?? t('managedAccounts.noUsernameYet')),
      customIcon: <Avatar name={name} uri={avatarUri} size={40} />,
      customContent: (
        <AccountRowContent
          node={node}
          isCurrent={isCurrent}
          isArchiving={isArchiving}
          onSwitchTo={onSwitchTo}
          onManageMembers={onManageMembers}
          onEditProfile={onEditProfile}
          onArchive={onArchive}
        />
      ),
      // Tapping the row switches INTO the account (Gmail-style). The current
      // account is not pressable (it is already active); accounts the caller
      // can't switch into fall back to the manage-members affordance.
      onPress: isCurrent
        ? undefined
        : canSwitchInto
          ? () => onSwitchTo(node.accountId)
          : canManageMembers
            ? () => onManageMembers(node.accountId)
            : undefined,
    };
  }, [currentAccountId, archivingId, oxyServices, onSwitchTo, onManageMembers, onEditProfile, onArchive, t, locale]);
}

const styles = StyleSheet.create({
  accountActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  currentIndicator: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  roleBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
});
