import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection, LoadingState, EmptyState } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';

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

    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    const tabActiveColor = themeStyles.colors.iconSecurity;
    const tabInactiveColor = themeStyles.isDarkTheme ? '#888888' : '#666666';

    // TODO: Implement API integration for saved items and collections
    // Currently sets empty arrays. Should fetch from oxyServices.getSavedItems() and oxyServices.getCollections()
    // Load saved items and collections
    useEffect(() => {
        const loadData = async () => {
            try {
                setIsLoading(true);
                if (user?.id && oxyServices) {
                    // TODO: Replace with actual API calls
                    // const saved = await oxyServices.getSavedItems(user.id);
                    // const cols = await oxyServices.getCollections(user.id);
                    // setSavedItems(saved);
                    // setCollections(cols);
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
                        activeTab === 'saves' && { borderBottomColor: tabActiveColor },
                    ]}
                    onPress={() => setActiveTab('saves')}
                >
                    <Text
                        style={[
                            styles.tabText,
                            {
                                color: activeTab === 'saves' ? tabActiveColor : tabInactiveColor,
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
                        activeTab === 'collections' && { borderBottomColor: tabActiveColor },
                    ]}
                    onPress={() => setActiveTab('collections')}
                >
                    <Text
                        style={[
                            styles.tabText,
                            {
                                color: activeTab === 'collections' ? tabActiveColor : tabInactiveColor,
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
                    <LoadingState
                        message={t('saves.loading') || 'Loading...'}
                        color={themeStyles.textColor}
                    />
                ) : activeTab === 'saves' ? (
                    savedItems.length === 0 ? (
                        <EmptyState
                            message={t('saves.empty') || 'No saved items yet'}
                            textColor={themeStyles.textColor}
                        />
                    ) : (
                        <Section title={t('saves.savedItems') || 'Saved Items'} isFirst={true}>
                            <GroupedSection
                                items={savedItems.map((item) => ({
                                    id: item.id,
                                    icon: item.type === 'post' ? 'document-text' : 'folder',
                                    iconColor: item.type === 'post' ? themeStyles.colors.iconSecurity : themeStyles.colors.iconStorage,
                                    title: item.title,
                                    subtitle: formatDate(item.savedAt),
                                }))}
                            />
                        </Section>
                    )
                ) : (
                    collections.length === 0 ? (
                        <EmptyState
                            message={t('saves.noCollections') || 'No collections yet'}
                            textColor={themeStyles.textColor}
                        />
                    ) : (
                        <Section title={t('saves.collections') || 'Collections'} isFirst={true}>
                            <GroupedSection
                                items={collections.map((collection) => ({
                                    id: collection.id,
                                    icon: 'folder',
                                    iconColor: themeStyles.colors.iconStorage,
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
});

export default React.memo(SavesCollectionsScreen);

