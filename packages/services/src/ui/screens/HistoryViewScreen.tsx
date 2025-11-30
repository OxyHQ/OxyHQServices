import React, { useState, useCallback } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import { Header, Section, GroupedSection, LoadingState, EmptyState } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';

interface HistoryItem {
    id: string;
    query: string;
    type: 'search' | 'browse';
    timestamp: Date;
}

const HistoryViewScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { user } = useOxy();
    const { t } = useI18n();
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isDeleting, setIsDeleting] = useState(false);

    // Helper to get storage
    const getStorage = async () => {
        const isReactNative = typeof navigator !== 'undefined' && navigator.product === 'ReactNative';

        if (isReactNative) {
            try {
                const asyncStorageModule = await import('@react-native-async-storage/async-storage');
                const storage = (asyncStorageModule.default as unknown) as any;
                return {
                    getItem: storage.getItem.bind(storage),
                    setItem: storage.setItem.bind(storage),
                    removeItem: storage.removeItem.bind(storage),
                };
            } catch (error) {
                console.error('AsyncStorage not available:', error);
                throw new Error('AsyncStorage is required in React Native environment');
            }
        } else {
            // Use localStorage for web
            return {
                getItem: async (key: string) => {
                    if (typeof window !== 'undefined' && window.localStorage) {
                        return window.localStorage.getItem(key);
                    }
                    return null;
                },
                setItem: async (key: string, value: string) => {
                    if (typeof window !== 'undefined' && window.localStorage) {
                        window.localStorage.setItem(key, value);
                    }
                },
                removeItem: async (key: string) => {
                    if (typeof window !== 'undefined' && window.localStorage) {
                        window.localStorage.removeItem(key);
                    }
                }
            };
        }
    };

    // TODO: Integrate with backend API for history storage
    // Currently uses local storage only. Should fetch from backend API and sync across devices.
    // Load history from storage
    React.useEffect(() => {
        const loadHistory = async () => {
            try {
                setIsLoading(true);
                const storage = await getStorage();
                const historyKey = `history_${user?.id || 'guest'}`;
                const stored = await storage.getItem(historyKey);

                if (stored) {
                    const parsed = JSON.parse(stored);
                    setHistory(parsed.map((item: any) => ({
                        ...item,
                        timestamp: new Date(item.timestamp),
                    })));
                } else {
                    setHistory([]);
                }
            } catch (error) {
                setHistory([]);
            } finally {
                setIsLoading(false);
            }
        };

        loadHistory();
    }, [user?.id]);

    const handleDeleteLast15Minutes = useCallback(async () => {
        confirmAction(
            t('history.deleteLast15Minutes.confirm') || 'Delete last 15 minutes of history?',
            async () => {
                try {
                    setIsDeleting(true);
                    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);

                    const filtered = history.filter(item => item.timestamp < fifteenMinutesAgo);
                    setHistory(filtered);

                    // Save to storage
                    const storage = await getStorage();
                    const historyKey = `history_${user?.id || 'guest'}`;
                    await storage.setItem(historyKey, JSON.stringify(filtered));

                    toast.success(t('history.deleteLast15Minutes.success') || 'Last 15 minutes deleted');
                } catch (error) {
                    console.error('Failed to delete history:', error);
                    toast.error(t('history.deleteLast15Minutes.error') || 'Failed to delete history');
                } finally {
                    setIsDeleting(false);
                }
            }
        );
    }, [history, user?.id, t]);

    const handleClearAll = useCallback(async () => {
        confirmAction(
            t('history.clearAll.confirm') || 'Clear all history? This cannot be undone.',
            async () => {
                try {
                    setIsDeleting(true);
                    setHistory([]);

                    // Clear from storage
                    const storage = await getStorage();
                    const historyKey = `history_${user?.id || 'guest'}`;
                    await storage.removeItem(historyKey);

                    toast.success(t('history.clearAll.success') || 'History cleared');
                } catch (error) {
                    console.error('Failed to clear history:', error);
                    toast.error(t('history.clearAll.error') || 'Failed to clear history');
                } finally {
                    setIsDeleting(false);
                }
            }
        );
    }, [user?.id, t]);

    const themeStyles = useThemeStyles(theme);

    const formatTime = (date: Date) => {
        const now = new Date();
        const diff = now.getTime() - date.getTime();
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (minutes < 1) return t('history.justNow') || 'Just now';
        if (minutes < 60) return `${minutes} ${t('history.minutesAgo') || 'minutes ago'}`;
        if (hours < 24) return `${hours} ${t('history.hoursAgo') || 'hours ago'}`;
        if (days < 7) return `${days} ${t('history.daysAgo') || 'days ago'}`;
        return date.toLocaleDateString();
    };

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('history.title') || 'History'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                {/* Actions */}
                <Section title={t('history.actions') || 'Actions'}  isFirst={true}>
                    <GroupedSection
                        items={[
                            {
                                id: 'delete-last-15',
                                icon: 'time-outline',
                                iconColor: '#FF9500',
                                title: t('history.deleteLast15Minutes.title') || 'Delete Last 15 Minutes',
                                subtitle: t('history.deleteLast15Minutes.subtitle') || 'Remove recent history entries',
                                onPress: handleDeleteLast15Minutes,
                                disabled: isDeleting || history.length === 0,
                            },
                            {
                                id: 'clear-all',
                                icon: 'trash-outline',
                                iconColor: '#FF3B30',
                                title: t('history.clearAll.title') || 'Clear All History',
                                subtitle: t('history.clearAll.subtitle') || 'Remove all history entries',
                                onPress: handleClearAll,
                                disabled: isDeleting || history.length === 0,
                            },
                        ]}
                        
                    />
                </Section>

                {/* History List */}
                <Section title={t('history.recent') || 'Recent History'}>
                    {isLoading ? (
                        <LoadingState
                            message={t('history.loading') || 'Loading history...'}
                            color={themeStyles.textColor}
                        />
                    ) : history.length === 0 ? (
                        <EmptyState
                            message={t('history.empty') || 'No history yet'}
                            textColor={themeStyles.textColor}
                        />
                    ) : (
                        <GroupedSection
                            items={history.map((item) => ({
                                id: item.id,
                                icon: item.type === 'search' ? 'search' : 'globe',
                                iconColor: item.type === 'search' ? '#007AFF' : '#32D74B',
                                title: item.query,
                                subtitle: formatTime(item.timestamp),
                            }))}
                        />
                    )}
                </Section>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        padding: 16,
    },
});

export default React.memo(HistoryViewScreen);

