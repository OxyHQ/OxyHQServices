import type React from 'react';
import { View, StyleSheet, ScrollView, Linking } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { Header } from '../components';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { SettingsIcon } from '../components/SettingsIcon';
import { useTheme } from '@oxyhq/bloom/theme';
import { useI18n } from '../hooks/useI18n';

interface UserLinksScreenProps extends BaseScreenProps {
    userId: string;
    links?: Array<{
        url: string;
        title?: string;
        description?: string;
        image?: string;
        id: string;
    }>;
}

const UserLinksScreen: React.FC<UserLinksScreenProps> = ({
    userId,
    links = [],
    theme,
    goBack,
    navigate
}) => {
    const bloomTheme = useTheme();
    const { t } = useI18n();

    const handleLinkPress = async (url: string) => {
        try {
            await Linking.openURL(url);
        } catch (error) {
            if (__DEV__) {
                console.error('Error opening link:', error);
            }
        }
    };

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('userLinks.title')}
                subtitle={links.length !== 1 ? t('userLinks.linkCount_plural', { count: links.length }) : t('userLinks.linkCount', { count: links.length })}
                onBack={goBack}
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                <SettingsListGroup title={t('userLinks.title')}>
                    {links.map((link) => (
                        <SettingsListItem
                            key={link.id}
                            icon={<SettingsIcon name="link" color="#32D74B" />}
                            title={link.title || link.url}
                            description={link.description || link.url}
                            onPress={() => handleLinkPress(link.url)}
                        />
                    ))}
                </SettingsListGroup>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f2f2f2',
    },
    content: {
        flex: 1,
        padding: 16,
    },
});

export default UserLinksScreen; 