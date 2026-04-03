import type React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BaseScreenProps } from '../types/navigation';
import { Header, GroupedSection } from '../components';
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

    const groupedItems = links.map((link) => ({
        id: link.id,
        icon: link.image ? undefined : 'link',
        iconColor: '#32D74B',
        image: link.image || undefined,
        imageSize: 40,
        title: link.title || link.url,
        subtitle: link.description || link.url,
        onPress: () => handleLinkPress(link.url),
        multiRow: true,
    }));

    return (
        <View style={styles.container} className="bg-background">
            <Header
                title={t('userLinks.title')}
                subtitle={links.length !== 1 ? t('userLinks.linkCount_plural', { count: links.length }) : t('userLinks.linkCount', { count: links.length })}
                onBack={goBack}
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                <View style={styles.section}>
                    <Text style={styles.sectionTitle} className="text-foreground">{t('userLinks.title')}</Text>

                    <GroupedSection
                        items={groupedItems}

                    />
                </View>
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
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
    },
});

export default UserLinksScreen; 