import React, { useState, useCallback } from 'react';
import { View, ScrollView } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '@oxyhq/bloom';
import Header from '../components/Header';
import { Loading } from '@oxyhq/bloom/loading';
import { Text } from '@oxyhq/bloom/typography';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';
import { surfaces } from '@oxyhq/bloom/surfaces';

interface HistoryItem { id: string; query: string; type: 'search' | 'browse'; timestamp: Date; }

const HistoryViewScreen: React.FC<BaseScreenProps> = ({ onClose, goBack }) => {
    // History is scoped to the ACTIVE account so a switch into an org/project/bot
    // shows that account's history, not the device-session owner's.
    const { user } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);

    const getStorage = async () => {
        const isRN = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
        if (isRN) {
            try {
                const mod = await import('@react-native-async-storage/async-storage');
                const s = mod.default as unknown as { getItem: (k: string) => Promise<string | null>; setItem: (k: string, v: string) => Promise<void>; removeItem: (k: string) => Promise<void> };
                return { getItem: s.getItem.bind(s), setItem: s.setItem.bind(s), removeItem: s.removeItem.bind(s) };
            } catch (e) { if (__DEV__) console.error('AsyncStorage not available:', e); throw new Error('AsyncStorage required'); }
        }
        return {
            getItem: async (k: string) => typeof window !== 'undefined' && window.localStorage ? window.localStorage.getItem(k) : null,
            setItem: async (k: string, v: string) => { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(k, v); },
            removeItem: async (k: string) => { if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(k); },
        };
    };

    React.useEffect(() => {
        const load = async () => {
            try {
                setIsLoading(true);
                const storage = await getStorage();
                const stored = await storage.getItem(`history_${user?.id || 'guest'}`);
                if (stored) { const parsed = JSON.parse(stored); setHistory(parsed.map((i: HistoryItem) => ({ ...i, timestamp: new Date(i.timestamp) }))); }
                else setHistory([]);
            } catch { setHistory([]); } finally { setIsLoading(false); }
        };
        load();
    }, [user?.id]);

    const handleDeleteLast15Minutes = useCallback(async () => {
        const confirmed = await surfaces.confirm({
            title: t('history.deleteLast15Minutes.title') || 'Delete Last 15 Minutes',
            message: t('history.deleteLast15Minutes.confirm') || 'Delete last 15 minutes of history?',
            confirmLabel: t('common.actions.delete') || 'Delete',
            cancelLabel: t('common.cancel') || 'Cancel',
            destructive: true,
        });
        if (!confirmed) return;
        try {
            setIsDeleting(true);
            const cutoff = new Date(Date.now() - 15 * 60 * 1000);
            const filtered = history.filter(item => item.timestamp < cutoff);
            setHistory(filtered);
            const storage = await getStorage();
            await storage.setItem(`history_${user?.id || 'guest'}`, JSON.stringify(filtered));
            toast.success(t('history.deleteLast15Minutes.success') || 'Last 15 minutes deleted');
        } catch (e) { if (__DEV__) console.error('Failed to delete history:', e); toast.error(t('history.deleteLast15Minutes.error') || 'Failed to delete history'); }
        finally { setIsDeleting(false); }
    }, [history, user?.id, t]);

    const handleClearAll = useCallback(async () => {
        const confirmed = await surfaces.confirm({
            title: t('history.clearAll.title') || 'Clear All History',
            message: t('history.clearAll.confirm') || 'Clear all history? This cannot be undone.',
            confirmLabel: t('history.clearAll.title') || 'Clear All',
            cancelLabel: t('common.cancel') || 'Cancel',
            destructive: true,
        });
        if (!confirmed) return;
        try {
            setIsDeleting(true); setHistory([]);
            const storage = await getStorage();
            await storage.removeItem(`history_${user?.id || 'guest'}`);
            toast.success(t('history.clearAll.success') || 'History cleared');
        } catch (e) { if (__DEV__) console.error('Failed to clear history:', e); toast.error(t('history.clearAll.error') || 'Failed to clear history'); }
        finally { setIsDeleting(false); }
    }, [user?.id, t]);

    const formatTime = (date: Date) => {
        const diff = new Date().getTime() - date.getTime();
        const min = Math.floor(diff / 60000); const hrs = Math.floor(min / 60); const days = Math.floor(hrs / 24);
        if (min < 1) return t('history.justNow') || 'Just now';
        if (min < 60) return `${min} ${t('history.minutesAgo') || 'minutes ago'}`;
        if (hrs < 24) return `${hrs} ${t('history.hoursAgo') || 'hours ago'}`;
        if (days < 7) return `${days} ${t('history.daysAgo') || 'days ago'}`;
        return date.toLocaleDateString();
    };

    return (
        <View className="flex-1 bg-bg">
            <Header title={t('history.title') || 'History'} onBack={goBack || onClose} variant="minimal" elevation="subtle" />
            <ScrollView className="flex-1">
                <View className="px-screen-margin pb-space-24">
                    <SettingsListGroup title={t('history.actions') || 'Actions'}>
                        <SettingsListItem
                            icon={<SettingsIcon name="clock-outline" color={bloomTheme.colors.warning} />}
                            title={t('history.deleteLast15Minutes.title') || 'Delete Last 15 Minutes'}
                            description={t('history.deleteLast15Minutes.subtitle') || 'Remove recent history entries'}
                            onPress={handleDeleteLast15Minutes}
                            disabled={isDeleting || history.length === 0}
                        />
                        <SettingsListItem
                            icon={<SettingsIcon name="delete-outline" color={bloomTheme.colors.error} />}
                            title={t('history.clearAll.title') || 'Clear All History'}
                            description={t('history.clearAll.subtitle') || 'Remove all history entries'}
                            onPress={handleClearAll}
                            disabled={isDeleting || history.length === 0}
                        />
                    </SettingsListGroup>
                    <SettingsListGroup title={t('history.recent') || 'Recent History'}>
                        {isLoading ? <Loading size="large" color={bloomTheme.colors.text} text={t('history.loading') || 'Loading history...'} />
                         : history.length === 0 ? <Text className="text-text-secondary text-center p-space-40">{t('history.empty') || 'No history yet'}</Text>
                         : history.map(item => (
                            <SettingsListItem
                                key={item.id}
                                icon={<SettingsIcon name={item.type === 'search' ? 'magnify' : 'earth'} color={item.type === 'search' ? bloomTheme.colors.info : bloomTheme.colors.primary} />}
                                title={item.query}
                                description={formatTime(item.timestamp)}
                            />
                        ))}
                    </SettingsListGroup>
                </View>
            </ScrollView>
        </View>
    );
};

export default React.memo(HistoryViewScreen);
