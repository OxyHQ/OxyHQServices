import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Dialog, toast, useDialogControl } from '@oxyhq/bloom';
import { useTheme } from '@oxyhq/bloom/theme';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import type { AuthorizedApp } from '@oxyhq/core';
import { logger as loggerUtil } from '@oxyhq/core';
import type { BaseScreenProps } from '../types/navigation';
import Header from '../components/Header';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import LoadingState from '../components/LoadingState';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';
import { useAuthorizedApps } from '../hooks/queries/useAccountQueries';
import { useRevokeAuthorizedApp } from '../hooks/mutations/useAccountMutations';

const APP_ICON_SIZE = 40;

/**
 * Format an ISO-8601 timestamp as a human-readable relative time. Mirrors the
 * formatter used in ManageAccountScreen — kept local to avoid pulling a new
 * shared module into the package public surface for one consumer.
 */
const formatRelative = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return '—';
    }
    const diffMs = Date.now() - date.getTime();
    const absMin = Math.abs(diffMs) / 60000;
    if (absMin < 1) return 'just now';
    if (absMin < 60) return `${Math.floor(absMin)}m ago`;
    const hrs = absMin / 60;
    if (hrs < 24) return `${Math.floor(hrs)}h ago`;
    const days = hrs / 24;
    if (days < 7) return `${Math.floor(days)}d ago`;
    return date.toLocaleDateString();
};

/**
 * ConnectedAppsScreen — list and revoke FedCM-authorized RP applications.
 *
 * Fetches via `useAuthorizedApps` (drives `GET /fedcm/me/authorized-apps`)
 * and exposes a "Revoke" action that hits `DELETE /fedcm/me/authorized-apps/
 * :origin`. Each revoke invalidates the connected-apps query so the list
 * refreshes immediately.
 */
const ConnectedAppsScreen: React.FC<BaseScreenProps> = ({ onClose, goBack }) => {
    const bloomTheme = useTheme();
    const { t } = useI18n();
    const { isAuthenticated } = useOxy();
    const {
        data: apps,
        isLoading,
        refetch,
        isRefetching,
    } = useAuthorizedApps({ enabled: isAuthenticated });
    const revokeMutation = useRevokeAuthorizedApp();
    const revokeDialog = useDialogControl();
    const [pendingRevoke, setPendingRevoke] = useState<AuthorizedApp | null>(null);
    const [revokingOrigin, setRevokingOrigin] = useState<string | null>(null);

    const confirmRevoke = useCallback(
        (app: AuthorizedApp) => {
            setPendingRevoke(app);
            revokeDialog.open();
        },
        [revokeDialog],
    );

    const handleRevoke = useCallback(async () => {
        if (!pendingRevoke) {
            return;
        }
        const target = pendingRevoke;
        setRevokingOrigin(target.origin);
        try {
            await revokeMutation.mutateAsync(target.origin);
            toast.success(
                t('connectedApps.toasts.revoked', { name: target.name })
                || `Revoked access for ${target.name}`,
            );
        } catch (error) {
            loggerUtil.warn(
                'Revoke authorized app failed',
                { component: 'ConnectedAppsScreen' },
                error,
            );
            toast.error(
                t('connectedApps.toasts.revokeFailed')
                || 'Failed to revoke access',
            );
        } finally {
            setRevokingOrigin(null);
            setPendingRevoke(null);
        }
    }, [pendingRevoke, revokeMutation, t]);

    const renderEmpty = useCallback(
        () => (
            <View className="flex-1 items-center justify-center py-space-32">
                <EmptyState
                    message={
                        t('connectedApps.empty.subtitle')
                        || 'Apps you authorize to sign in with your Oxy account will appear here'
                    }
                    textColor={bloomTheme.colors.textSecondary}
                />
            </View>
        ),
        [t, bloomTheme.colors.textSecondary],
    );

    const renderItem = useCallback(
        ({ item }: { item: AuthorizedApp }) => {
            const isRevoking = revokingOrigin === item.origin;
            return (
                <SettingsListGroup>
                    <SettingsListItem
                        icon={<Avatar name={item.name} size={APP_ICON_SIZE} />}
                        title={item.name}
                        description={
                            t('connectedApps.item.lastUsed', {
                                relative: formatRelative(item.lastUsedAt),
                            })
                            || `Last used ${formatRelative(item.lastUsedAt)}`
                        }
                        onPress={isRevoking ? undefined : () => confirmRevoke(item)}
                        disabled={isRevoking}
                        destructive
                        showChevron={false}
                        rightElement={
                            isRevoking ? (
                                <ActivityIndicator
                                    color={bloomTheme.colors.error}
                                    size="small"
                                />
                            ) : undefined
                        }
                    />
                </SettingsListGroup>
            );
        },
        [bloomTheme.colors.error, confirmRevoke, revokingOrigin, t],
    );

    return (
        <View className="flex-1 bg-bg">
            <Header
                title={t('connectedApps.title') || 'Connected apps'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />
            {isLoading && !apps ? (
                <LoadingState color={bloomTheme.colors.primary} />
            ) : (
                <FlatList
                    data={apps ?? []}
                    keyExtractor={(item) => item.origin}
                    renderItem={renderItem}
                    contentContainerClassName="px-screen-margin py-space-16"
                    contentContainerStyle={styles.listContent}
                    ListEmptyComponent={renderEmpty}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefetching}
                            onRefresh={refetch}
                            tintColor={bloomTheme.colors.primary}
                        />
                    }
                />
            )}
            <Dialog
                control={revokeDialog}
                title={t('connectedApps.confirm.title') || 'Revoke access'}
                description={
                    pendingRevoke
                        ? (t('connectedApps.confirm.message', { name: pendingRevoke.name })
                            || `Revoke ${pendingRevoke.name}'s access to your Oxy account?`)
                        : ''
                }
                actions={[
                    {
                        label: t('common.revoke') || 'Revoke',
                        color: 'destructive',
                        onPress: handleRevoke,
                    },
                    { label: t('common.cancel') || 'Cancel', color: 'cancel' },
                ]}
            />
        </View>
    );
};

// Layout-only style: `flexGrow` lets the FlatList content fill the viewport so
// the empty state centers vertically. Not expressible as a Bloom token class —
// all colors, spacing, radius, and typography live on token classes + Bloom
// components.
const styles = StyleSheet.create({
    listContent: {
        flexGrow: 1,
    },
});

export default React.memo(ConnectedAppsScreen);
