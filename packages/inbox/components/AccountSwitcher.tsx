/**
 * Gmail-style account switcher component.
 *
 * Renders inside the MailboxDrawer's popover menu:
 * - Current account (larger avatar, name, email, checkmark)
 * - Other saved accounts in a compact list
 * - "Add another account" row
 * - Per-account sign-out option
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
} from 'react-native';
import { Loading } from '@oxyhq/bloom/loading';
import { Divider } from '@oxyhq/bloom/divider';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  Tick02Icon,
  Add01Icon,
  Logout01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import { useColors } from '@/constants/theme';
import { Avatar } from '@/components/Avatar';
import { useAccountSwitcher } from '@/hooks/useAccountSwitcher';
import type { StoredAccount } from '@/utils/accountStorage';

interface AccountSwitcherProps {
  onClose: () => void;
  onSettings: () => void;
  onAddAccount: () => void;
}

function AccountRow({
  account,
  isActive,
  colors,
  onSwitch,
  onSignOut,
  isSwitching,
}: {
  account: StoredAccount;
  isActive: boolean;
  colors: ReturnType<typeof useColors>;
  onSwitch: () => void;
  onSignOut: () => void;
  isSwitching: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.accountRow, isActive && { backgroundColor: colors.surfaceVariant }]}
      onPress={onSwitch}
      activeOpacity={0.6}
      disabled={isSwitching}
    >
      <Avatar
        name={account.displayName || account.username || '?'}
        size={isActive ? 40 : 32}
        avatarUrl={account.avatarUrl}
      />
      <View style={styles.accountRowInfo}>
        <Text
          style={[
            styles.accountRowName,
            { color: colors.text },
            isActive && styles.accountRowNameActive,
          ]}
          numberOfLines={1}
        >
          {account.displayName || account.username}
        </Text>
        <Text
          style={[styles.accountRowEmail, { color: colors.secondaryText }]}
          numberOfLines={1}
        >
          {account.email}
        </Text>
      </View>
      {isActive ? (
        Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={Tick02Icon as unknown as IconSvgElement}
            size={18}
            color={colors.primary}
            strokeWidth={2.5}
          />
        ) : (
          <MaterialCommunityIcons name="check" size={18} color={colors.primary} />
        )
      ) : (
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={(e) => {
            e.stopPropagation?.();
            onSignOut();
          }}
          activeOpacity={0.6}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon
              icon={Logout01Icon as unknown as IconSvgElement}
              size={16}
              color={colors.secondaryText}
            />
          ) : (
            <MaterialCommunityIcons name="logout" size={16} color={colors.secondaryText} />
          )}
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

export function AccountSwitcher({ onClose, onSettings, onAddAccount }: AccountSwitcherProps) {
  const colors = useColors();
  const { accounts, currentUserId, isSwitching, switchAccount, signOutAccount } =
    useAccountSwitcher();

  // Current account first, then others sorted by lastActive desc
  const sortedAccounts = useMemo(() => {
    const current = accounts.filter((a) => a.userId === currentUserId);
    const others = accounts
      .filter((a) => a.userId !== currentUserId)
      .sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime());
    return [...current, ...others];
  }, [accounts, currentUserId]);

  const handleSwitch = useCallback(
    async (userId: string) => {
      if (userId === currentUserId) return;
      const ok = await switchAccount(userId);
      if (ok) {
        onClose();
      }
    },
    [currentUserId, switchAccount, onClose],
  );

  const handleSignOut = useCallback(
    async (userId: string) => {
      await signOutAccount(userId);
      if (userId === currentUserId) {
        onClose();
      }
    },
    [signOutAccount, currentUserId, onClose],
  );

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          ...Platform.select({
            web: { boxShadow: '0 4px 24px rgba(0,0,0,0.18)' } as Record<string, string>,
            default: {},
          }),
        },
      ]}
    >
      {/* Accounts list */}
      <View style={styles.accountsList}>
        {sortedAccounts.map((account) => (
          <AccountRow
            key={account.userId}
            account={account}
            isActive={account.userId === currentUserId}
            colors={colors}
            onSwitch={() => handleSwitch(account.userId)}
            onSignOut={() => handleSignOut(account.userId)}
            isSwitching={isSwitching}
          />
        ))}
      </View>

      {/* Switching indicator */}
      {isSwitching && (
        <View style={styles.switchingRow}>
          <Loading variant="inline" size="small" />
          <Text style={[styles.switchingText, { color: colors.secondaryText }]}>
            Switching account...
          </Text>
        </View>
      )}

      <Divider />

      {/* Add account */}
      <TouchableOpacity
        style={styles.actionRow}
        onPress={onAddAccount}
        activeOpacity={0.6}
      >
        {Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={Add01Icon as unknown as IconSvgElement}
            size={20}
            color={colors.icon}
          />
        ) : (
          <MaterialCommunityIcons name="plus" size={20} color={colors.icon} />
        )}
        <Text style={[styles.actionText, { color: colors.text }]}>Add another account</Text>
      </TouchableOpacity>

      <Divider />

      {/* Settings */}
      <TouchableOpacity style={styles.actionRow} onPress={onSettings} activeOpacity={0.6}>
        {Platform.OS === 'web' ? (
          <HugeiconsIcon
            icon={Settings01Icon as unknown as IconSvgElement}
            size={18}
            color={colors.icon}
          />
        ) : (
          <MaterialCommunityIcons name="cog-outline" size={18} color={colors.icon} />
        )}
        <Text style={[styles.actionText, { color: colors.text }]}>Settings</Text>
      </TouchableOpacity>

      {/* Sign out current account */}
      {currentUserId && (
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => handleSignOut(currentUserId)}
          activeOpacity={0.6}
        >
          {Platform.OS === 'web' ? (
            <HugeiconsIcon
              icon={Logout01Icon as unknown as IconSvgElement}
              size={18}
              color={colors.icon}
            />
          ) : (
            <MaterialCommunityIcons name="logout" size={18} color={colors.icon} />
          )}
          <Text style={[styles.actionText, { color: colors.text }]}>Sign out</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: '100%',
    left: 8,
    right: 8,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    zIndex: 100,
  },
  accountsList: {
    paddingVertical: 4,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  accountRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  accountRowName: {
    fontSize: 13,
    fontWeight: '500',
  },
  accountRowNameActive: {
    fontWeight: '600',
  },
  accountRowEmail: {
    fontSize: 11,
    marginTop: 1,
  },
  signOutButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    opacity: 0.6,
  },
  switchingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  switchingText: {
    fontSize: 12,
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '500',
  },
});
