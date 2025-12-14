import React, { useState, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, TextInput, LayoutAnimation } from 'react-native';
import type { BaseScreenProps } from '../../types/navigation';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { normalizeTheme } from '../../utils/themeUtils';

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
    const [expanded, setExpanded] = useState<number | null>(0);
    const [search, setSearch] = useState('');

    // Memoize theme-related calculations to prevent unnecessary recalculations
    const normalizedTheme = normalizeTheme(theme);
    const baseThemeStyles = useThemeStyles(normalizedTheme);
    const themeStyles = useMemo(() => ({
        ...baseThemeStyles,
        cardColor: baseThemeStyles.isDarkTheme ? '#23232b' : '#f7f7fa',
        primaryColor: '#d169e5',
        inputBg: baseThemeStyles.isDarkTheme ? '#23232b' : '#f2f2f7',
        inputBorder: baseThemeStyles.borderColor,
    }), [baseThemeStyles]);

    // Memoize filtered FAQs to prevent filtering on every render
    const faqs = useMemo(() => FAQ_KEYS.map(key => ({
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
    const handleToggle = useCallback((idx: number) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(prev => prev === idx ? null : idx);
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
            <View style={[styles.searchBar, { backgroundColor: themeStyles.inputBg, borderColor: themeStyles.inputBorder }]}>
                <Ionicons name="search-outline" size={20} color={themeStyles.primaryColor} style={{ marginRight: 8 }} />
                <TextInput
                    style={[styles.searchInput, { color: themeStyles.textColor }]}
                    placeholder={t('karma.faq.search') || 'Search FAQ...'}
                    placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#888'}
                    value={search}
                    onChangeText={setSearch}
                    returnKeyType="search"
                />
            </View>
            <ScrollView contentContainerStyle={styles.contentContainer}>
                {filteredFaqs.length === 0 ? (
                    <Text style={[styles.noResults, { color: themeStyles.textColor }]}>
                        {t('karma.faq.noResults', { query: search }) || `No FAQ items found matching "${search}"`}
                    </Text>
                ) : (
                    filteredFaqs.map((faq, idx) => (
                        <TouchableOpacity
                            key={idx}
                            style={[styles.card, { backgroundColor: themeStyles.cardColor }]}
                            onPress={() => handleToggle(idx)}
                            activeOpacity={0.7}
                        >
                            <View style={styles.questionRow}>
                                <Text style={[styles.question, { color: themeStyles.textColor }]}>
                                    {faq.q}
                                </Text>
                                <Ionicons
                                    name={expanded === idx ? 'chevron-up' : 'chevron-down'}
                                    size={20}
                                    color={themeStyles.primaryColor}
                                />
                            </View>
                            {expanded === idx && (
                                <Text style={[styles.answer, { color: themeStyles.textColor }]}>
                                    {faq.a}
                                </Text>
                            )}
                        </TouchableOpacity>
                    ))
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 38,
        margin: 24,
        marginBottom: 12,
        textAlign: 'center',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 16,
        borderWidth: 1,
        marginHorizontal: 24,
        marginBottom: 12,
        paddingHorizontal: 12,
        height: 44,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        height: 44,
    },
    contentContainer: { padding: 24, paddingTop: 20, paddingBottom: 40 },
    card: {
        borderRadius: 18,
        padding: 20,
        marginBottom: 18,
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 2,
    },
    questionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    question: {
        fontSize: 17,
        fontWeight: 'bold',
        flex: 1,
    },
    answer: {
        fontSize: 16,
        lineHeight: 22,
        marginTop: 8,
    },
    paragraph: {
        fontSize: 16,
        marginBottom: 12,
    },
    noResults: {
        fontSize: 16,
        marginTop: 32,
        textAlign: 'center',
        opacity: 0.7,
    },
});

export default React.memo(KarmaFAQScreen);
