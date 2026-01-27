import React, { useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BaseScreenProps } from '../types/navigation';
import { Header } from '../components';
import { useThemeStyles } from '../hooks/useThemeStyles';

interface InfoSection {
    id: string;
    title: string;
    content: string;
    icon: string;
}

const INFO_SECTIONS: InfoSection[] = [
    {
        id: 'what',
        title: 'What is a username?',
        content: 'Your username is your unique identifier on Oxy. It\'s how other people find and mention you. Think of it like your handle on social media - it\'s public and represents your identity across all Oxy apps.',
        icon: 'at-outline',
    },
    {
        id: 'rules',
        title: 'Username rules',
        content: 'Usernames can only contain lowercase letters (a-z) and numbers (0-9). They must be at least 4 characters long. Special characters, spaces, and uppercase letters are not allowed to keep usernames simple and easy to remember.',
        icon: 'list-outline',
    },
    {
        id: 'unique',
        title: 'Why must it be unique?',
        content: 'Each username can only belong to one person. This ensures that when someone searches for you or mentions you, they find the right person. It also prevents confusion and impersonation.',
        icon: 'finger-print-outline',
    },
    {
        id: 'change',
        title: 'Can I change it later?',
        content: 'Yes! You can change your username anytime in your account settings. Keep in mind that your old username will become available for others to use, and people who knew your old username will need to find you with the new one.',
        icon: 'refresh-outline',
    },
    {
        id: 'tips',
        title: 'Tips for choosing a username',
        content: 'Choose something memorable and easy to spell. Avoid using personal information like your birth year or phone number. Consider using a name that represents you across all contexts - professional and personal.',
        icon: 'bulb-outline',
    },
];

const LearnMoreUsernamesScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const themeStyles = useThemeStyles(theme || 'light');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set(['what'])); // Start with first section expanded

    const toggleExpanded = useCallback((id: string) => {
        setExpandedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

    const styles = useMemo(() => createStyles(themeStyles), [themeStyles]);

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title="About usernames"
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.contentContainer}
            >
                <View style={styles.introSection}>
                    <View style={[styles.introIcon, { backgroundColor: themeStyles.primaryColor + '15' }]}>
                        <Ionicons name="at" size={32} color={themeStyles.primaryColor} />
                    </View>
                    <Text style={[styles.introTitle, { color: themeStyles.textColor }]}>
                        Your unique identity
                    </Text>
                    <Text style={[styles.introText, { color: themeStyles.mutedTextColor }]}>
                        Your username is how people find and recognize you across all Oxy apps.
                    </Text>
                </View>

                {INFO_SECTIONS.map((section, index) => {
                    const isExpanded = expandedIds.has(section.id);
                    return (
                        <View
                            key={section.id}
                            style={[
                                styles.section,
                                { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor: themeStyles.borderColor },
                                index === 0 && styles.sectionFirst,
                            ]}
                        >
                            <TouchableOpacity
                                style={styles.sectionHeader}
                                onPress={() => toggleExpanded(section.id)}
                                accessibilityRole="button"
                                accessibilityLabel={section.title}
                                accessibilityHint={isExpanded ? 'Collapse section' : 'Expand section'}
                                accessibilityState={{ expanded: isExpanded }}
                            >
                                <View style={[styles.sectionIconContainer, { backgroundColor: themeStyles.primaryColor + '15' }]}>
                                    <Ionicons
                                        name={section.icon}
                                        size={20}
                                        color={themeStyles.primaryColor}
                                    />
                                </View>
                                <Text style={[styles.sectionTitle, { color: themeStyles.textColor }]}>
                                    {section.title}
                                </Text>
                                <Ionicons
                                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                    size={20}
                                    color={themeStyles.mutedTextColor}
                                />
                            </TouchableOpacity>
                            {isExpanded && (
                                <View style={[styles.sectionContent, { borderTopColor: themeStyles.borderColor }]}>
                                    <Text style={[styles.sectionText, { color: themeStyles.mutedTextColor }]}>
                                        {section.content}
                                    </Text>
                                </View>
                            )}
                        </View>
                    );
                })}

                <View style={styles.footer}>
                    <Text style={[styles.footerText, { color: themeStyles.mutedTextColor }]}>
                        Need more help? Visit our Help Center for additional information.
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
};

const createStyles = (themeStyles: ReturnType<typeof useThemeStyles>) => StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
    },
    contentContainer: {
        padding: 16,
        paddingBottom: 32,
    },
    introSection: {
        alignItems: 'center',
        paddingVertical: 24,
        paddingHorizontal: 16,
    },
    introIcon: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    introTitle: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 8,
        textAlign: 'center',
    },
    introText: {
        fontSize: 16,
        lineHeight: 24,
        textAlign: 'center',
    },
    section: {
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 12,
        overflow: 'hidden',
    },
    sectionFirst: {
        marginTop: 8,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
    },
    sectionIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    sectionTitle: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        marginRight: 12,
    },
    sectionContent: {
        padding: 16,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    sectionText: {
        fontSize: 14,
        lineHeight: 22,
    },
    footer: {
        marginTop: 16,
        paddingHorizontal: 16,
    },
    footerText: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
});

export default LearnMoreUsernamesScreen;
