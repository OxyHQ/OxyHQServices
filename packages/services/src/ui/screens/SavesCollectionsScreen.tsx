import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';

interface SavedItem {
    id: string;
    title: string;
    type: 'post' | 'collection';
    savedAt: Date;
    url?: string;
}

const SavesCollectionsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { oxyServices, user } = useOxy();
    const { t } = useI18n();
    const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
    const [collections, setCollections] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'saves' | 'collections'>('saves');

    // Load saved items and collections
    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                if (user?.id && oxyServices) {
                    setSavedItems([]);
                    setCollections([]);
                }
            } catch (error) {
                toast.error(t('saves.loadError') || 'Failed to load saved items');
            } finally {
                setIsLoading(false);
            }
        };

        loadData();
    }, [user?.id, oxyServices, t]);

    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#FFFFFF',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#F5F5F5',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
            tabActiveColor: '#007AFF',
            tabInactiveColor: isDarkTheme ? '#888888' : '#666666',
        };
    }, [theme]);

    const formatDate = (date: Date) => {
        return date.toLocaleDateString();
    };

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('saves.title') || 'Saves & Collections'}
                
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            {/* Tabs */}
            <View style={[styles.tabs, { borderBottomColor: themeStyles.borderColor }]}>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'saves' && { borderBottomColor: themeStyles.tabActiveColor },
                    ]}
                    onPress={() => setActiveTab('saves')}
                >
                    <Text
                        style={[
                            styles.tabText,
                            {
                                color: activeTab === 'saves' ? themeStyles.tabActiveColor : themeStyles.tabInactiveColor,
                                fontWeight: activeTab === 'saves' ? '600' : '400',
                            },
                        ]}
                    >
                        {t('saves.tabs.saves') || 'Saves'}
                    </Text>
                </TouchableOpacity>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'collections' && { borderBottomColor: themeStyles.tabActiveColor },
                    ]}
                    onPress={() => setActiveTab('collections')}
                >
                    <Text
                        style={[
                            styles.tabText,
                            {
                                color: activeTab === 'collections' ? themeStyles.tabActiveColor : themeStyles.tabInactiveColor,
                                fontWeight: activeTab === 'collections' ? '600' : '400',
                            },
                        ]}
                    >
                        {t('saves.tabs.collections') || 'Collections'}
                    </Text>
                </TouchableOpacity>
            </View>

            <ScrollView style={styles.content}>
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="large" color={themeStyles.textColor} />
                        <Text style={[styles.loadingText, { color: themeStyles.textColor }]}>
                            {t('saves.loading') || 'Loading...'}
                        </Text>
                    </View>
                ) : activeTab === 'saves' ? (
                    savedItems.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Text style={[styles.emptyText, { color: themeStyles.textColor }]}>
                                {t('saves.empty') || 'No saved items yet'}
                            </Text>
                        </View>
                    ) : (
                        <Section title={t('saves.savedItems') || 'Saved Items'}  isFirst={true}>
                            <GroupedSection
                                items={savedItems.map((item) => ({
                                    id: item.id,
                                    icon: item.type === 'post' ? 'document-text' : 'folder',
                                    iconColor: item.type === 'post' ? '#007AFF' : '#FF9500',
                                    title: item.title,
                                    subtitle: formatDate(item.savedAt),
                                }))}
                                
                            />
                        </Section>
                    )
                ) : (
                    collections.length === 0 ? (
                        <View style={styles.emptyContainer}>
                            <Text style={[styles.emptyText, { color: themeStyles.textColor }]}>
                                {t('saves.noCollections') || 'No collections yet'}
                            </Text>
                        </View>
                    ) : (
                        <Section title={t('saves.collections') || 'Collections'}  isFirst={true}>
                            <GroupedSection
                                items={collections.map((collection) => ({
                                    id: collection.id,
                                    icon: 'folder',
                                    iconColor: '#FF9500',
                                    title: collection.name,
                                    subtitle: `${collection.itemCount || 0} items`,
                                }))}
                                
                            />
                        </Section>
                    )
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    tabs: {
        flexDirection: 'row',
        borderBottomWidth: 1,
    },
    tab: {
        flex: 1,
        paddingVertical: 16,
        alignItems: 'center',
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabText: {
        fontSize: 16,
    },
    content: {
        flex: 1,
        padding: 16,
    },
    loadingContainer: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
    },
    emptyContainer: {
        padding: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyText: {
        fontSize: 16,
        textAlign: 'center',
    },
});

export default React.memo(SavesCollectionsScreen);

