import type React from 'react';
import { useState, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { useI18n } from '../hooks/useI18n';

interface InfoSection {
    id: string;
    titleKey: string;
    contentKey: string;
    icon: string;
}

const INFO_SECTIONS: InfoSection[] = [
    {
        id: 'what',
        titleKey: 'learnMoreUsernames.sections.what.title',
        contentKey: 'learnMoreUsernames.sections.what.content',
        icon: 'at-outline',
    },
    {
        id: 'rules',
        titleKey: 'learnMoreUsernames.sections.rules.title',
        contentKey: 'learnMoreUsernames.sections.rules.content',
        icon: 'list-outline',
    },
    {
        id: 'unique',
        titleKey: 'learnMoreUsernames.sections.unique.title',
        contentKey: 'learnMoreUsernames.sections.unique.content',
        icon: 'finger-print-outline',
    },
    {
        id: 'change',
        titleKey: 'learnMoreUsernames.sections.change.title',
        contentKey: 'learnMoreUsernames.sections.change.content',
        icon: 'refresh-outline',
    },
    {
        id: 'tips',
        titleKey: 'learnMoreUsernames.sections.tips.title',
        contentKey: 'learnMoreUsernames.sections.tips.content',
        icon: 'bulb-outline',
    },
];

const LearnMoreUsernamesScreen: React.FC<BaseScreenProps> = ({
    theme,
}) => {
    const bloomTheme = useTheme();
    const { t } = useI18n();
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

    const styles = useMemo(() => createStyles(), []);

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <ScrollView
                style={styles.content}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.contentContainer}
            >
                <View style={styles.introSection}>
                    <View style={[styles.introIcon, { backgroundColor: `${bloomTheme.colors.primary}15` }]}>
                        <Ionicons name="at" size={32} color={bloomTheme.colors.primary} />
                    </View>
                    <Text style={[styles.introTitle, { color: bloomTheme.colors.text }]}>
                        {t('learnMoreUsernames.introTitle')}
                    </Text>
                    <Text style={[styles.introText, { color: bloomTheme.colors.textSecondary }]}>
                        {t('learnMoreUsernames.introText')}
                    </Text>
                </View>

                {INFO_SECTIONS.map((section, index) => {
                    const isExpanded = expandedIds.has(section.id);
                    const sectionTitle = t(section.titleKey);
                    return (
                        <View
                            key={section.id}
                            style={[
                                styles.section,
                                { backgroundColor: bloomTheme.colors.backgroundSecondary, borderColor: bloomTheme.colors.border },
                                index === 0 && styles.sectionFirst,
                            ]}
                        >
                            <TouchableOpacity
                                style={styles.sectionHeader}
                                onPress={() => toggleExpanded(section.id)}
                                accessibilityRole="button"
                                accessibilityLabel={sectionTitle}
                                accessibilityHint={isExpanded ? t('learnMoreUsernames.collapseHint') : t('learnMoreUsernames.expandHint')}
                                accessibilityState={{ expanded: isExpanded }}
                            >
                                <View style={[styles.sectionIconContainer, { backgroundColor: `${bloomTheme.colors.primary}15` }]}>
                                    <Ionicons
                                        name={section.icon}
                                        size={20}
                                        color={bloomTheme.colors.primary}
                                    />
                                </View>
                                <Text style={[styles.sectionTitle, { color: bloomTheme.colors.text }]}>
                                    {sectionTitle}
                                </Text>
                                <Ionicons
                                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                    size={20}
                                    color={bloomTheme.colors.textSecondary}
                                />
                            </TouchableOpacity>
                            {isExpanded && (
                                <View style={[styles.sectionContent, { borderTopColor: bloomTheme.colors.border }]}>
                                    <Text style={[styles.sectionText, { color: bloomTheme.colors.textSecondary }]}>
                                        {t(section.contentKey)}
                                    </Text>
                                </View>
                            )}
                        </View>
                    );
                })}

                <View style={styles.footer}>
                    <Text style={[styles.footerText, { color: bloomTheme.colors.textSecondary }]}>
                        {t('learnMoreUsernames.footer')}
                    </Text>
                </View>
            </ScrollView>
        </View>
    );
};

const createStyles = () => StyleSheet.create({
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
