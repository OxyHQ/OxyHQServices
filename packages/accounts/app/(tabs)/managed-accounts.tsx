import React, { useMemo, useCallback, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, ActivityIndicator, Platform } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader, AccountCard, useAlert } from '@/components/ui';
import { UnauthenticatedScreen } from '@/components/unauthenticated-screen';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { useOxy, Avatar } from '@oxyhq/services';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';
import type { ManagedAccount } from '@oxyhq/core';

function getRoleBadgeColor(role: string, colors: typeof Colors.light): string {
  switch (role) {
    case 'owner':
      return colors.sidebarIconPersonalInfo;
    case 'admin':
      return colors.sidebarIconSecurity;
    case 'editor':
      return colors.sidebarIconPayments;
    default:
      return colors.icon;
  }
}

function getAccountDisplayName(account: ManagedAccount): string {
  const user = account.account;
  if (!user) return 'Unknown';
  if (typeof user.name === 'object' && user.name) {
    const { first, last, full } = user.name as { first?: string; last?: string; full?: string };
    if (full) return full;
    if (first || last) return [first, last].filter(Boolean).join(' ');
  }
  if (typeof user.name === 'string' && user.name) return user.name;
  return user.username || 'Unnamed';
}

function getUserRole(account: ManagedAccount, userId?: string): string {
  if (!userId) return 'unknown';
  const manager = account.managers.find((m) => m.userId === userId);
  return manager?.role ?? 'unknown';
}

export default function ManagedAccountsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const alert = useAlert();
  const handlePressIn = useHapticPress();

  const {
    user,
    isAuthenticated,
    isLoading: oxyLoading,
    managedAccounts,
    actingAs,
    setActingAs,
    showBottomSheet,
    oxyServices,
    refreshManagedAccounts,
  } = useOxy();

  const [refreshing, setRefreshing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const userId = typeof user?._id === 'string' ? user._id : user?.id?.toString();

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshManagedAccounts();
    } catch (error) {
      console.error('Failed to refresh managed accounts', error);
    } finally {
      setRefreshing(false);
    }
  }, [refreshManagedAccounts]);

  const handleCreateAccount = useCallback(() => {
    showBottomSheet?.('CreateManagedAccount');
  }, [showBottomSheet]);

  const handleActAs = useCallback((accountId: string) => {
    if (actingAs === accountId) {
      setActingAs(null);
    } else {
      setActingAs(accountId);
    }
  }, [actingAs, setActingAs]);

  const handleEditProfile = useCallback((accountId: string) => {
    setActingAs(accountId);
    showBottomSheet?.({
      screen: 'EditProfileField',
      props: { fieldType: 'displayName' },
    });
  }, [setActingAs, showBottomSheet]);

  const handleDeleteAccount = useCallback((account: ManagedAccount) => {
    const name = getAccountDisplayName(account);
    alert(
      'Delete Managed Account',
      `Are you sure you want to permanently delete "${name}"? This action cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              setDeletingId(account.accountId);
              await oxyServices.deleteManagedAccount(account.accountId);
              if (actingAs === account.accountId) {
                setActingAs(null);
              }
              await refreshManagedAccounts();
            } catch (error) {
              console.error('Failed to delete managed account', error);
              alert('Error', 'Failed to delete managed account. Please try again.');
            } finally {
              setDeletingId(null);
            }
          },
        },
      ],
    );
  }, [oxyServices, actingAs, setActingAs, refreshManagedAccounts, alert]);

  const accountListItems = useMemo(() => {
    return managedAccounts.map((account) => {
      const name = getAccountDisplayName(account);
      const username = account.account?.username;
      const role = getUserRole(account, userId);
      const isActingAs = actingAs === account.accountId;
      const isDeleting = deletingId === account.accountId;
      const avatarUri = account.account?.avatar
        ? oxyServices.getFileDownloadUrl(account.account.avatar, 'thumb')
        : undefined;
      const badgeColor = getRoleBadgeColor(role, colors);

      return {
        id: account.accountId,
        title: name,
        subtitle: username ? `@${username}` : 'No username set',
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
              <Text style={[styles.roleBadgeText, { color: badgeColor }]}>
                {role}
              </Text>
            </View>
            {isDeleting ? (
              <ActivityIndicator size="small" color={colors.text} />
            ) : (
              <View style={styles.actionButtons}>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: isActingAs ? colors.success + '20' : colors.card }]}
                  onPressIn={handlePressIn}
                  onPress={() => handleActAs(account.accountId)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons
                    name={isActingAs ? 'account-check' : 'account-switch'}
                    size={16}
                    color={isActingAs ? colors.success : colors.text}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionButton, { backgroundColor: colors.card }]}
                  onPressIn={handlePressIn}
                  onPress={() => handleEditProfile(account.accountId)}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.text} />
                </TouchableOpacity>
                {role === 'owner' && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: colors.card }]}
                    onPressIn={handlePressIn}
                    onPress={() => handleDeleteAccount(account)}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="delete-outline" size={16} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        ),
        onPress: () => handleActAs(account.accountId),
      };
    });
  }, [managedAccounts, userId, actingAs, deletingId, oxyServices, colors, handlePressIn, handleActAs, handleEditProfile, handleDeleteAccount]);

  if (oxyLoading) {
    return (
      <ScreenContentWrapper>
        <View style={[styles.container, styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.tint} />
          <ThemedText style={[styles.loadingText, { color: colors.text }]}>Loading...</ThemedText>
        </View>
      </ScreenContentWrapper>
    );
  }

  if (!isAuthenticated) {
    return (
      <UnauthenticatedScreen
        title="Managed Accounts"
        subtitle="Create and manage sub-accounts."
        message="Please sign in to manage your identities."
        isAuthenticated={isAuthenticated}
      />
    );
  }

  return (
    <ScreenContentWrapper refreshing={refreshing} onRefresh={handleRefresh}>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <ScreenHeader
            title="Your Identities"
            subtitle="Create and manage sub-accounts for different purposes. Each identity has its own profile, username, and content."
          />

          <Section title="">
            <TouchableOpacity
              style={[styles.createButton, { backgroundColor: colors.tint }]}
              onPressIn={handlePressIn}
              onPress={handleCreateAccount}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="account-plus-outline" size={20} color="#FFFFFF" />
              <Text style={styles.createButtonText}>Create New Identity</Text>
            </TouchableOpacity>
          </Section>

          {actingAs && (
            <Section title="">
              <AccountCard>
                <GroupedSection items={[{
                  id: 'acting-as-info',
                  icon: 'information-outline',
                  iconColor: colors.sidebarIconSecurity,
                  title: 'You are currently acting as another identity',
                  subtitle: 'Actions in other apps will be performed as this identity',
                  onPress: () => setActingAs(null),
                  showChevron: false,
                }]} />
              </AccountCard>
            </Section>
          )}

          {accountListItems.length === 0 ? (
            <Section title="">
              <View style={styles.emptyState}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.sidebarIconSharing + '20' }]}>
                  <MaterialCommunityIcons name="account-group-outline" size={48} color={colors.sidebarIconSharing} />
                </View>
                <ThemedText style={styles.emptyTitle}>No managed accounts</ThemedText>
                <ThemedText style={[styles.emptySubtitle, { color: colors.icon }]}>
                  Create sub-accounts for different contexts such as work, personal branding, or team management.
                </ThemedText>
              </View>
            </Section>
          ) : (
            <Section title={`${accountListItems.length} ${accountListItems.length === 1 ? 'Identity' : 'Identities'}`}>
              <AccountCard>
                <GroupedSection items={accountListItems} />
              </AccountCard>
            </Section>
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
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-SemiBold',
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
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-SemiBold',
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
    fontFamily: Platform.OS === 'web' ? 'Inter' : 'Inter-SemiBold',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
});
