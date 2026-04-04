import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection, LoadingState, EmptyState } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme } from '../utils/themeUtils';
import { useOxy } from '../context/OxyContext';
import * as Prompt from '@oxyhq/bloom/prompt';
import { usePromptControl } from '@oxyhq/bloom/prompt';

interface HistoryItem { id: string; query: string; type: 'search' | 'browse'; timestamp: Date; }

const HistoryViewScreen: React.FC<BaseScreenProps> = ({ onClose, theme, goBack }) => {
    const { user } = useOxy();
    const { t } = useI18n();
    const bloomTheme = useTheme();
    const colorScheme = useColorScheme();
    const normalizedColorScheme = normalizeColorScheme(colorScheme);
    const themeColors = Colors[normalizedColorScheme];
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);
    const deleteLast15Prompt = usePromptControl();
    const clearAllPrompt = usePromptControl();

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
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header title={t('history.title') || 'History'} onBack={goBack || onClose} variant="minimal" elevation="subtle" />
            <ScrollView style={styles.content}>
                <Section title={t('history.actions') || 'Actions'} isFirst={true}>
                    <GroupedSection items={[
                        { id: 'delete-last-15', icon: 'clock-outline', iconColor: themeColors.iconStorage, title: t('history.deleteLast15Minutes.title') || 'Delete Last 15 Minutes', subtitle: t('history.deleteLast15Minutes.subtitle') || 'Remove recent history entries', onPress: () => deleteLast15Prompt.open(), disabled: isDeleting || history.length === 0 },
                        { id: 'clear-all', icon: 'delete-outline', iconColor: themeColors.iconSharing, title: t('history.clearAll.title') || 'Clear All History', subtitle: t('history.clearAll.subtitle') || 'Remove all history entries', onPress: () => clearAllPrompt.open(), disabled: isDeleting || history.length === 0 },
                    ]} />
                </Section>
                <Section title={t('history.recent') || 'Recent History'}>
                    {isLoading ? <LoadingState message={t('history.loading') || 'Loading history...'} color={bloomTheme.colors.text} />
                     : history.length === 0 ? <EmptyState message={t('history.empty') || 'No history yet'} textColor={bloomTheme.colors.text} />
                     : <GroupedSection items={history.map(item => ({ id: item.id, icon: item.type === 'search' ? 'search' : 'globe', iconColor: item.type === 'search' ? themeColors.iconSecurity : themeColors.iconPersonalInfo, title: item.query, subtitle: formatTime(item.timestamp) }))} />}
                </Section>
            </ScrollView>
            <Prompt.Basic control={deleteLast15Prompt} title={t('history.deleteLast15Minutes.title') || 'Delete Last 15 Minutes'} description={t('history.deleteLast15Minutes.confirm') || 'Delete last 15 minutes of history?'} onConfirm={handleDeleteLast15Minutes} confirmButtonCta={t('common.actions.delete') || 'Delete'} confirmButtonColor="negative" />
            <Prompt.Basic control={clearAllPrompt} title={t('history.clearAll.title') || 'Clear All History'} description={t('history.clearAll.confirm') || 'Clear all history? This cannot be undone.'} onConfirm={handleClearAll} confirmButtonCta={t('history.clearAll.title') || 'Clear All'} confirmButtonColor="negative" />
        </View>
    );
};

const styles = StyleSheet.create({ container: { flex: 1 }, content: { flex: 1, padding: 16 } });

export default React.memo(HistoryViewScreen);
