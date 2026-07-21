import type React from 'react';
import { View, Linking } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import Header from '../components/Header';
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
        <>
            <Header
                title={t('userLinks.title')}
                subtitle={links.length !== 1 ? t('userLinks.linkCount_plural', { count: links.length }) : t('userLinks.linkCount', { count: links.length })}
                onBack={goBack}
                variant="minimal"
                elevation="subtle"
            />

            <View className="px-screen-margin pb-space-24">
                    <SettingsListGroup title={t('userLinks.title')}>
                        {links.map((link) => (
                            <SettingsListItem
                                key={link.id}
                                icon={<SettingsIcon name="link" color={bloomTheme.colors.success} />}
                                title={link.title || link.url}
                                description={link.description || link.url}
                                onPress={() => handleLinkPress(link.url)}
                            />
                        ))}
                    </SettingsListGroup>
                </View>
        </>
    );
};

export default UserLinksScreen;
