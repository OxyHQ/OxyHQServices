import { useMemo } from 'react';
import type { AccountNode } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';
import type { HomeHandlers } from './useHomeHandlers';

interface UseManagedAccountItemsArgs {
  accounts: AccountNode[];
  actingAs: string | null;
  handleManagedAccounts: HomeHandlers['handleManagedAccounts'];
  handleCreateManagedAccount: HomeHandlers['handleCreateManagedAccount'];
}

/**
 * Builds the "Accounts" rows on the home screen. When the user has accounts
 * beyond their own personal one it shows a count + create + manage-all trio;
 * otherwise it shows a single "no accounts yet" call-to-action.
 *
 * The accessible forest from the SDK includes the caller's own personal
 * (`self`) account; that root is excluded here so the count reflects only the
 * accounts the user manages or has been given access to.
 */
export function useManagedAccountItems({
  accounts,
  actingAs,
  handleManagedAccounts,
  handleCreateManagedAccount,
}: UseManagedAccountItemsArgs): GroupedItem[] {
  const colors = useColors();
  const { t } = useTranslation();

  return useMemo<GroupedItem[]>(() => {
    const manageable = accounts.filter((a) => a.relationship !== 'self');
    const items: GroupedItem[] = [];
    if (manageable.length > 0) {
      items.push({
        id: 'managed-count',
        icon: 'account-group',
        iconColor: colors.sidebarIconSharing,
        title: t('home.identities.managedCount', { count: manageable.length }),
        subtitle: actingAs ? t('home.identities.managedActingAs') : t('home.identities.managedSubtitle'),
        onPress: handleManagedAccounts,
        showChevron: true,
      });
      items.push({
        id: 'create-account',
        icon: 'account-plus-outline',
        iconColor: colors.sidebarIconPersonalInfo,
        title: t('home.identities.createNew'),
        onPress: handleCreateManagedAccount,
        showChevron: true,
      });
      items.push({
        id: 'manage-all',
        icon: 'account-cog-outline',
        iconColor: colors.sidebarIconData,
        title: t('home.identities.manageAll'),
        onPress: handleManagedAccounts,
        showChevron: true,
      });
    } else {
      items.push({
        id: 'no-managed',
        icon: 'account-plus-outline',
        iconColor: colors.sidebarIconSharing,
        title: t('home.identities.noManaged'),
        subtitle: t('home.identities.noManagedSubtitle'),
        onPress: handleCreateManagedAccount,
        showChevron: true,
      });
    }
    return items;
  }, [accounts, actingAs, colors.sidebarIconSharing, colors.sidebarIconPersonalInfo, colors.sidebarIconData, handleManagedAccounts, handleCreateManagedAccount, t]);
}
