import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BaseScreenProps } from '../navigation/types';
import { Header, GroupedSection } from '../components';

interface UserLinksScreenProps extends BaseScreenProps {
    userId: string;
    links: Array<{
        url: string;
        title?: string;
        description?: string;
        image?: string;
        id: string;
    }>;
}

const UserLinksScreen: React.FC<UserLinksScreenProps> = ({
    userId,
    links,
    theme,
    goBack,
    navigate
}) => {
    const isDarkTheme = theme === 'dark';
    const themeStyles = {
        backgroundColor: isDarkTheme ? '#000' : '#f2f2f2',
        textColor: isDarkTheme ? '#fff' : '#333',
        primaryColor: '#007AFF',
    };

    const handleLinkPress = async (url: string) => {
        try {
            await Linking.openURL(url);
        } catch (error) {
            console.error('Error opening link:', error);
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
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title="Links"
                subtitle={`${links.length} link${links.length !== 1 ? 's' : ''}`}
                theme={theme}
                onBack={goBack}
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: themeStyles.textColor }]}>Links</Text>

                    <GroupedSection
                        items={groupedItems}
                        theme={theme}
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