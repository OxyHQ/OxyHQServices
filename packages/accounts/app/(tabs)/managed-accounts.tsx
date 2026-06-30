import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useColors, type AppColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader, AccountCard } from '@/components/ui';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import type { GroupedItem } from '@/components/sections/types';
import { useOxy, Avatar } from '@oxyhq/services';
import { alert, toast } from '@oxyhq/bloom';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useTranslation } from '@/lib/i18n';
import type { AccountNode, AccountRole } from '@oxyhq/core';
import { getAccountDisplayName as coreGetAccountDisplayName, getAccountFallbackHandle } from '@oxyhq/core';

// Roles that may post/act as the account (delegated identity). Mirrors the
// `account:act_as` capability mapping in the account role set (owner/admin/editor).
const ACT_AS_ROLES: readonly AccountRole[] = ['owner', 'admin', 'editor'];
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

function getAccountDisplayName(node: AccountNode, locale?: string): string {
  return coreGetAccountDisplayName(node.account ?? null, locale);
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

export default function ManagedAccountsScreen() {
  const colors = useColors();
  const handlePressIn = useHapticPress();
  const { t, locale } = useTranslation();

  // Auth is enforced by the `(tabs)` layout — assume a session here.
  const {
    isLoading: oxyLoading,
    accounts,
    actingAs,
    setActingAs,
    showBottomSheet,
    oxyServices,
    refreshAccounts,
  } = useOxy();

  const [refreshing, setRefreshing] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshAccounts();
    } catch (error) {
      console.error('Failed to refresh accounts', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshAccounts]);

  const handleCreateAccount = useCallback(() => {
    showBottomSheet?.('CreateAccount');
  }, [showBottomSheet]);

  const handleActAs = useCallback((accountId: string) => {
    setActingAs(actingAs === accountId ? null : accountId);
  }, [actingAs, setActingAs]);

  const handleManageMembers = useCallback((accountId: string) => {
    showBottomSheet?.({ screen: 'AccountMembers', props: { accountId } });
  }, [showBottomSheet]);

  const handleEditProfile = useCallback((accountId: string) => {
    // Editing a non-personal account's profile happens through the shared
    // profile editor while acting as that account.
    setActingAs(accountId);
    showBottomSheet?.({
      screen: 'EditProfileField',
      props: { fieldType: 'displayName' },
    });
  }, [setActingAs, showBottomSheet]);

  const handleArchiveAccount = useCallback((node: AccountNode) => {
    const name = getAccountDisplayName(node, locale);
    alert(
      t('managedAccounts.archive.confirmTitle'),
      t('managedAccounts.archive.confirmBody', { name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('managedAccounts.archive.confirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              setArchivingId(node.accountId);
              await oxyServices.archiveAccount(node.accountId);
              if (actingAs === node.accountId) {
                setActingAs(null);
              }
              await refreshAccounts();
            } catch (error) {
              console.error('Failed to archive account', error);
              toast.error(t('managedAccounts.archive.error'));
            } finally {
              setArchivingId(null);
            }
          },
        },
      ],
    );
  }, [oxyServices, actingAs, setActingAs, refreshAccounts, locale, t]);

  const buildItem = useCallback((node: AccountNode): GroupedItem => {
    const name = getAccountDisplayName(node, locale);
    const username = node.account?.username;
    // When an account has no username yet (e.g. mid-provisioning) fall back to
    // a truncated `publicKey` handle so the row still reads as identifiable
    // rather than showing "No username set".
    const fallbackHandle = getAccountFallbackHandle(node.account ?? null);
    const role = getNodeRole(node);
    const isActingAs = actingAs === node.accountId;
    const isArchiving = archivingId === node.accountId;
    const avatarUri = node.account?.avatar
      ? oxyServices.getFileDownloadUrl(node.account.avatar, 'thumb')
      : undefined;
    const badgeColor = getRoleBadgeColor(role, colors);
    const canActAs = ACT_AS_ROLES.includes(role);
    const canManageMembers = MANAGE_MEMBER_ROLES.includes(role);
    const canEdit = EDIT_ROLES.includes(role);
    const canArchive = role === 'owner';

    return {
      id: node.accountId,
      title: name,
      subtitle: username
        ? `@${username}`
        : (fallbackHandle ?? t('managedAccounts.noUsernameYet')),
      customIcon: (
        <View style={styles.avatarContainer}>
          <Avatar name={name} uri={avatarUri} size={40} />
          {isActingAs && (
            <View style={[styles.activeIndicator, { backgroundColor: colors.success }]} />
          )}
        </View>
      ),
      customContent: (
        <View style={styles.accountActions}>
          <View style={[styles.roleBadge, { backgroundColor: badgeColor + '20', borderColor: badgeColor + '40' }]}>
            <Text style={[styles.roleBadgeText, { color: badgeColor }]}>{role}</Text>
          </View>
          {isArchiving ? (
            <ActivityIndicator size="small" color={colors.text} />
          ) : (
            <View style={styles.actionButtons}>
              {canActAs && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: isActingAs ? colors.success + '20' : colors.card }]}
                  onPressIn={handlePressIn}
                  onPress={() => handleActAs(node.accountId)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={isActingAs ? t('a11y.stopActingAs') : t('a11y.actAs')}
                  accessibilityState={{ selected: isActingAs }}
                >
                  <MaterialCommunityIcons
                    name={isActingAs ? 'account-check' : 'account-switch'}
                    size={16}
                    color={isActingAs ? colors.success : colors.text}
                  />
                </TouchableOpacity>
              )}
              {canManageMembers && (
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.card }]}
                  onPressIn={handlePressIn}
                  onPress={() => handleManageMembers(node.accountId)}
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
                  onPress={() => handleEditProfile(node.accountId)}
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
                  onPress={() => handleArchiveAccount(node)}
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
      ),
      onPress: canActAs ? () => handleActAs(node.accountId) : () => handleManageMembers(node.accountId),
    };
  }, [actingAs, archivingId, oxyServices, colors, handlePressIn, handleActAs, handleManageMembers, handleEditProfile, handleArchiveAccount, t, locale]);

  // Partition the accessible forest: accounts the caller owns (grouped by kind)
  // and accounts shared with them via membership. The caller's own personal
  // (`self`) account is naturally excluded — it is neither a managed kind nor a
  // `member` relationship.
  const groups = useMemo(() => {
    const owned = accounts.filter((a) => a.relationship !== 'member' && a.kind !== 'personal');
    return {
      organizations: owned.filter((a) => a.kind === 'organization'),
      projects: owned.filter((a) => a.kind === 'project'),
      bots: owned.filter((a) => a.kind === 'bot'),
      shared: accounts.filter((a) => a.relationship === 'member'),
    };
  }, [accounts]);

  const totalCount = groups.organizations.length + groups.projects.length + groups.bots.length + groups.shared.length;

  if (oxyLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>{t('common.loading')}</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  return (
    <ScreenContentWrapper refreshing={refreshing} onRefresh={handleRefresh}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader
            title={t('managedAccounts.title')}
            subtitle={t('managedAccounts.subtitle')}
          />

          <Section title="">
            <TouchableOpacity
              style={[styles.createButton, { backgroundColor: colors.tint }]}
              onPressIn={handlePressIn}
              onPress={handleCreateAccount}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={t('managedAccounts.createNew')}
            >
              <MaterialCommunityIcons name="account-plus-outline" size={20} color="#FFFFFF" />
              <Text style={styles.createButtonText}>{t('managedAccounts.createNew')}</Text>
            </TouchableOpacity>
          </Section>

          {actingAs && (
            <Section title="">
              <AccountCard>
                <GroupedSection items={[{
                  id: 'acting-as-info',
                  icon: 'information-outline',
                  iconColor: colors.sidebarIconSecurity,
                  title: t('managedAccounts.actingAsTitle'),
                  subtitle: t('managedAccounts.actingAsSubtitle'),
                  onPress: () => setActingAs(null),
                  showChevron: false,
                }]} />
              </AccountCard>
            </Section>
          )}

          {totalCount === 0 ? (
            <Section title="">
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.sidebarIconSharing + '20' }]}>
                  <MaterialCommunityIcons name="account-group-outline" size={48} color={colors.sidebarIconSharing} />
                </View>
                <ThemedText style={styles.emptyTitle}>{t('managedAccounts.empty.title')}</ThemedText>
                <ThemedText style={[styles.emptySubtitle, { color: colors.icon }]}>
                  {t('managedAccounts.empty.subtitle')}
                </ThemedText>
              </View>
            </Section>
          ) : (
            <>
              {groups.organizations.length > 0 && (
                <Section title={t('managedAccounts.groups.organizations')}>
                  <AccountCard>
                    <GroupedSection items={groups.organizations.map(buildItem)} />
                  </AccountCard>
                </Section>
              )}
              {groups.projects.length > 0 && (
                <Section title={t('managedAccounts.groups.projects')}>
                  <AccountCard>
                    <GroupedSection items={groups.projects.map(buildItem)} />
                  </AccountCard>
                </Section>
              )}
              {groups.bots.length > 0 && (
                <Section title={t('managedAccounts.groups.bots')}>
                  <AccountCard>
                    <GroupedSection items={groups.bots.map(buildItem)} />
                  </AccountCard>
                </Section>
              )}
              {groups.shared.length > 0 && (
                <Section title={t('managedAccounts.groups.shared')}>
                  <AccountCard>
                    <GroupedSection items={groups.shared.map(buildItem)} />
                  </AccountCard>
                </Section>
              )}
            </>
          )}
        </View>
      </View>
    </ScreenContentWrapper>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 16,
    opacity: 0.7,
  },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 28,
    gap: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  avatarContainer: {
    position: 'relative',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
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
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
