import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    TextInput,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { Header, LoadingState, EmptyState } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useOxy } from '../context/OxyContext';

interface FAQ {
    id: string;
    question: string;
    answer: string;
    category: string;
}

const FAQScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { oxyServices } = useOxy();
    const { t } = useI18n();
    const themeStyles = useThemeStyles(theme || 'light');

    const [faqs, setFaqs] = useState<FAQ[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

    // Load FAQs from API
    useEffect(() => {
        const loadFAQs = async () => {
            try {
                setIsLoading(true);
                const data = await oxyServices.getFAQs();
                setFaqs(data);
            } catch (error) {
                toast.error(t('faq.loadError') || 'Failed to load FAQs');
            } finally {
                setIsLoading(false);
            }
        };

        loadFAQs();
    }, [oxyServices, t]);

    // Get unique categories
    const categories = useMemo(() => {
        const cats = [...new Set(faqs.map(f => f.category))];
        return cats.sort();
    }, [faqs]);

    // Filter FAQs based on search and category
    const filteredFaqs = useMemo(() => {
        let result = faqs;

        if (selectedCategory) {
            result = result.filter(f => f.category === selectedCategory);
        }

        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            result = result.filter(f =>
                f.question.toLowerCase().includes(query) ||
                f.answer.toLowerCase().includes(query)
            );
        }

        return result;
    }, [faqs, searchQuery, selectedCategory]);

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
                title={t('faq.title') || 'FAQ'}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            {/* Search bar */}
            <View style={styles.searchContainer}>
                <View style={[styles.searchInputWrapper, { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor: themeStyles.borderColor }]}>
                    <Ionicons name="search" size={20} color={themeStyles.mutedTextColor} style={styles.searchIcon} />
                    <TextInput
                        style={[styles.searchInput, { color: themeStyles.textColor }]}
                        placeholder={t('faq.searchPlaceholder') || 'Search FAQs...'}
                        placeholderTextColor={themeStyles.mutedTextColor}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        accessibilityLabel="Search FAQs"
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity
                            onPress={() => setSearchQuery('')}
                            accessibilityRole="button"
                            accessibilityLabel="Clear search"
                        >
                            <Ionicons name="close-circle" size={20} color={themeStyles.mutedTextColor} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Category filters */}
            {categories.length > 0 && (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.categoriesContainer}
                    contentContainerStyle={styles.categoriesContent}
                >
                    <TouchableOpacity
                        style={[
                            styles.categoryChip,
                            !selectedCategory && styles.categoryChipActive,
                            { backgroundColor: !selectedCategory ? themeStyles.primaryColor : themeStyles.secondaryBackgroundColor }
                        ]}
                        onPress={() => setSelectedCategory(null)}
                        accessibilityRole="button"
                        accessibilityLabel="Show all categories"
                        accessibilityState={{ selected: !selectedCategory }}
                    >
                        <Text style={[
                            styles.categoryChipText,
                            { color: !selectedCategory ? '#FFFFFF' : themeStyles.textColor }
                        ]}>
                            {t('faq.allCategories') || 'All'}
                        </Text>
                    </TouchableOpacity>
                    {categories.map(cat => (
                        <TouchableOpacity
                            key={cat}
                            style={[
                                styles.categoryChip,
                                selectedCategory === cat && styles.categoryChipActive,
                                { backgroundColor: selectedCategory === cat ? themeStyles.primaryColor : themeStyles.secondaryBackgroundColor }
                            ]}
                            onPress={() => setSelectedCategory(cat)}
                            accessibilityRole="button"
                            accessibilityLabel={`Filter by ${cat}`}
                            accessibilityState={{ selected: selectedCategory === cat }}
                        >
                            <Text style={[
                                styles.categoryChipText,
                                { color: selectedCategory === cat ? '#FFFFFF' : themeStyles.textColor }
                            ]}>
                                {cat}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            )}

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {isLoading ? (
                    <LoadingState
                        message={t('faq.loading') || 'Loading FAQs...'}
                        color={themeStyles.textColor}
                    />
                ) : filteredFaqs.length === 0 ? (
                    <EmptyState
                        message={searchQuery ? (t('faq.noResults') || 'No FAQs match your search') : (t('faq.empty') || 'No FAQs available')}
                        textColor={themeStyles.textColor}
                    />
                ) : (
                    filteredFaqs.map((faq, index) => {
                        const isExpanded = expandedIds.has(faq.id);
                        return (
                            <View
                                key={faq.id}
                                style={[
                                    styles.faqItem,
                                    { backgroundColor: themeStyles.secondaryBackgroundColor, borderColor: themeStyles.borderColor },
                                    index === 0 && styles.faqItemFirst,
                                ]}
                            >
                                <TouchableOpacity
                                    style={styles.faqQuestion}
                                    onPress={() => toggleExpanded(faq.id)}
                                    accessibilityRole="button"
                                    accessibilityLabel={faq.question}
                                    accessibilityHint={isExpanded ? 'Collapse answer' : 'Expand answer'}
                                    accessibilityState={{ expanded: isExpanded }}
                                >
                                    <Text style={[styles.faqQuestionText, { color: themeStyles.textColor }]}>
                                        {faq.question}
                                    </Text>
                                    <Ionicons
                                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                                        size={20}
                                        color={themeStyles.mutedTextColor}
                                    />
                                </TouchableOpacity>
                                {isExpanded && (
                                    <View style={[styles.faqAnswer, { borderTopColor: themeStyles.borderColor }]}>
                                        <Text style={[styles.faqAnswerText, { color: themeStyles.mutedTextColor }]}>
                                            {faq.answer}
                                        </Text>
                                        <View style={styles.faqCategory}>
                                            <Ionicons name="pricetag-outline" size={14} color={themeStyles.primaryColor} />
                                            <Text style={[styles.faqCategoryText, { color: themeStyles.primaryColor }]}>
                                                {faq.category}
                                            </Text>
                                        </View>
                                    </View>
                                )}
                            </View>
                        );
                    })
                )}
            </ScrollView>
        </View>
    );
};

const createStyles = (themeStyles: any) => StyleSheet.create({
    container: {
        flex: 1,
    },
    searchContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    searchInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 12,
        borderWidth: 1,
        paddingHorizontal: 12,
        height: 44,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        ...Platform.select({
            web: { outlineStyle: 'none' as any },
        }),
    },
    categoriesContainer: {
        maxHeight: 50,
    },
    categoriesContent: {
        paddingHorizontal: 16,
        gap: 8,
    },
    categoryChip: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        marginRight: 8,
    },
    categoryChipActive: {},
    categoryChipText: {
        fontSize: 14,
        fontWeight: '500',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    faqItem: {
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 12,
        overflow: 'hidden',
    },
    faqItemFirst: {
        marginTop: 0,
    },
    faqQuestion: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    faqQuestionText: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
        marginRight: 12,
    },
    faqAnswer: {
        padding: 16,
        paddingTop: 12,
        borderTopWidth: 1,
    },
    faqAnswerText: {
        fontSize: 14,
        lineHeight: 22,
    },
    faqCategory: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 12,
    },
    faqCategoryText: {
        fontSize: 12,
        marginLeft: 6,
        fontWeight: '500',
    },
});

export default FAQScreen;
