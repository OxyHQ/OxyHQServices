import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, TextInput, LayoutAnimation } from 'react-native';
import type { BaseScreenProps } from '../../types/navigation';
import { Ionicons } from '@expo/vector-icons';
import { Header, GroupedItem } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { normalizeTheme, normalizeColorScheme } from '../../utils/themeUtils';
import { useColorScheme } from '../../hooks/useColorScheme';
import { Colors } from '../../constants/theme';

const FAQ_KEYS = ['what', 'earn', 'lose', 'use', 'transfer', 'support'] as const;

/**
 * KarmaFAQScreen - Optimized for performance
 * 
 * Performance optimizations implemented:
 * - useMemo for theme calculations (only recalculates when theme changes)
 * - useMemo for filtered FAQs (only recalculates when search changes)
 * - useCallback for event handlers to prevent unnecessary re-renders
 * - React.memo wrapper to prevent re-renders when props haven't changed
 */
const KarmaFAQScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const { t } = useI18n();
    const [expanded, setExpanded] = useState<string | null>(null);
    const [search, setSearch] = useState('');

    // Memoize theme-related calculations to prevent unnecessary recalculations
    const normalizedTheme = normalizeTheme(theme);
    const baseThemeStyles = useThemeStyles(normalizedTheme);
    const colorScheme = useColorScheme();
    const normalizedColorScheme = normalizeColorScheme(colorScheme);
    const colors = Colors[normalizedColorScheme];
    const themeStyles = useMemo(() => ({
        ...baseThemeStyles,
        primaryColor: '#d169e5',
        inputBg: baseThemeStyles.isDarkTheme ? '#23232b' : '#f2f2f7',
        inputBorder: baseThemeStyles.borderColor,
    }), [baseThemeStyles]);

    // Memoize filtered FAQs to prevent filtering on every render
    const faqs = useMemo(() => FAQ_KEYS.map(key => ({
        id: key,
        q: t(`karma.faq.items.${key}.q`) || '',
        a: t(`karma.faq.items.${key}.a`) || '',
    })), [t]);

    const filteredFaqs = useMemo(() => {
        if (!search.trim()) return faqs;
        const searchLower = search.toLowerCase();
        return faqs.filter(faq =>
            faq.q.toLowerCase().includes(searchLower) ||
            faq.a.toLowerCase().includes(searchLower)
        );
    }, [search, faqs]);

    // Memoize toggle handler to prevent recreation on every render
    const handleToggle = useCallback((id: string) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(prev => prev === id ? null : id);
    }, []);

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('karma.faq.title') || 'Karma FAQ'}
                subtitle={t('karma.faq.subtitle') || 'Frequently asked questions about karma'}
                subtitleVariant="muted"

                onBack={goBack}
                elevation="subtle"
            />
            <ScrollView
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
            >
                <View style={[styles.searchContainer, { backgroundColor: colors.card }]}>
                    <Ionicons name="search" size={22} color={colors.icon} />
                    <TextInput
                        style={[styles.searchInput, { color: themeStyles.textColor }]}
                        placeholder={t('karma.faq.search') || 'Search FAQ...'}
                        placeholderTextColor={themeStyles.isDarkTheme ? '#BBBBBB' : '#888888'}
                        value={search}
                        onChangeText={setSearch}
                        returnKeyType="search"
                    />
                </View>
                {filteredFaqs.length === 0 ? (
                    <Text style={[styles.noResults, { color: colors.secondaryText }]}>
                        {t('karma.faq.noResults', { query: search }) || `No FAQ items found matching "${search}"`}
                    </Text>
                ) : (
                    <View style={styles.groupedSectionContainer}>
                        {filteredFaqs.map((faq, idx) => {
                            const isExpanded = expanded === faq.id;
                            const isFirst = idx === 0;
                            const isLast = idx === filteredFaqs.length - 1;

                            return (
                                <View key={faq.id} style={[styles.faqItemWrapper, { marginBottom: idx < filteredFaqs.length - 1 ? 4 : 0 }]}>
                                    <GroupedItem
                                        title={faq.q}
                                        onPress={() => handleToggle(faq.id)}
                                        isFirst={isFirst}
                                        isLast={isLast && !isExpanded}
                                        showChevron={false}
                                        customContent={
                                            <Ionicons
                                                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                                size={20}
                                                color={colors.icon}
                                            />
                                        }
                                    />
                                    {isExpanded && (
                                        <View style={[styles.answerContainer, { backgroundColor: colors.card }, isLast && styles.lastAnswerContainer]}>
                                            <Text style={[styles.answer, { color: themeStyles.textColor }]}>
                                                {faq.a}
                                            </Text>
                                        </View>
                                    )}
                                </View>
                            );
                        })}
                    </View>
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    contentContainer: {
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 40,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: 12,
        borderRadius: 999,
        gap: 10,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        lineHeight: 20,
    },
    groupedSectionContainer: {
        width: '100%',
    },
    faqItemWrapper: {
        width: '100%',
    },
    answerContainer: {
        paddingHorizontal: 10,
        paddingTop: 4,
        paddingBottom: 12,
    },
    lastAnswerContainer: {
        borderBottomLeftRadius: 18,
        borderBottomRightRadius: 18,
    },
    answer: {
        fontSize: 14,
        lineHeight: 20,
    },
    noResults: {
        fontSize: 16,
        marginTop: 32,
        textAlign: 'center',
    },
});

export default React.memo(KarmaFAQScreen);
