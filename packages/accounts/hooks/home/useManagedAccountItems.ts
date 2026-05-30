import { useMemo } from 'react';
import type { ManagedAccount } from '@oxyhq/core';
import { useColors } from '@/hooks/useColors';
import { useTranslation } from '@/lib/i18n';
import type { GroupedItem } from '@/components/sections/types';
import type { HomeHandlers } from './useHomeHandlers';

interface UseManagedAccountItemsArgs {
  managedAccounts: ManagedAccount[];
  actingAs: string | null;
  handleManagedAccounts: HomeHandlers['handleManagedAccounts'];
  handleCreateManagedAccount: HomeHandlers['handleCreateManagedAccount'];
}

/**
 * Builds the "Your identities" rows on the home screen. When the user has
 * managed accounts it shows a count + create + manage-all trio; otherwise it
 * shows a single "no managed accounts yet" call-to-action.
 *
 * Extracted verbatim from the screen's inline `useMemo`.
 */
export function useManagedAccountItems({
  managedAccounts,
  actingAs,
  handleManagedAccounts,
  handleCreateManagedAccount,
}: UseManagedAccountItemsArgs): GroupedItem[] {
  const colors = useColors();
  const { t } = useTranslation();

  return useMemo<GroupedItem[]>(() => {
    const items: GroupedItem[] = [];
    if (managedAccounts.length > 0) {
      items.push({
        id: 'managed-count',
        icon: 'account-group',
        iconColor: colors.sidebarIconSharing,
        title: t('home.identities.managedCount', { count: managedAccounts.length }),
        subtitle: actingAs ? t('home.identities.managedActingAs') : t('home.identities.managedSubtitle'),
        onPress: handleManagedAccounts,
        showChevron: true,
      });
      items.push({
        id: 'create-identity',
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
  }, [managedAccounts, actingAs, colors.sidebarIconSharing, colors.sidebarIconPersonalInfo, colors.sidebarIconData, handleManagedAccounts, handleCreateManagedAccount, t]);
}
