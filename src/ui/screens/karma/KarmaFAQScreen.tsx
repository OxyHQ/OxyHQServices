import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, TextInput, LayoutAnimation, UIManager } from 'react-native';
import { BaseScreenProps } from '../../navigation/types';
import { Ionicons } from '@expo/vector-icons';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const FAQS = [
    {
        q: 'What is karma?',
        a: 'Karma is a recognition of your positive actions in the Oxy Ecosystem. It cannot be sent or received directly.'
    },
    {
        q: 'How do I earn karma?',
        a: 'By helping others, reporting bugs, contributing content, and participating in community events.'
    },
    {
        q: 'Can I lose karma?',
        a: 'Karma may be reduced for negative actions or breaking community rules.'
    },
    {
        q: 'What can I do with karma?',
        a: 'Unlock rewards, badges, and special features as you earn more karma.'
    },
    {
        q: 'Can I transfer karma to others?',
        a: 'No, karma cannot be sent or received. It is only earned by your actions.'
    },
    {
        q: 'How do I get support?',
        a: 'Contact Oxy support via the app or website for any karma-related questions.'
    },
];

const KarmaFAQScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const cardColor = isDarkTheme ? '#23232b' : '#f7f7fa';
    const primaryColor = '#d169e5';
    const inputBg = isDarkTheme ? '#23232b' : '#f2f2f7';
    const inputBorder = isDarkTheme ? '#444' : '#e0e0e0';

    const [expanded, setExpanded] = useState<number | null>(0);
    const [search, setSearch] = useState('');

    const filteredFaqs = FAQS.filter(faq =>
        faq.q.toLowerCase().includes(search.toLowerCase()) ||
        faq.a.toLowerCase().includes(search.toLowerCase())
    );

    const handleToggle = (idx: number) => {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setExpanded(expanded === idx ? null : idx);
    };

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <Text style={[styles.title, { color: textColor }]}>Karma FAQ</Text>
            <View style={[styles.searchBar, { backgroundColor: inputBg, borderColor: inputBorder }]}>
                <Ionicons name="search-outline" size={20} color={primaryColor} style={{ marginRight: 8 }} />
                <TextInput
                    style={[styles.searchInput, { color: textColor }]}
                    placeholder="Search FAQ..."
                    placeholderTextColor={isDarkTheme ? '#aaa' : '#888'}
                    value={search}
                    onChangeText={setSearch}
                    returnKeyType="search"
                />
            </View>
            <ScrollView contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
                {filteredFaqs.length === 0 ? (
                    <Text style={[styles.noResults, { color: textColor }]}>No results found.</Text>
                ) : (
                    filteredFaqs.map((item, idx) => {
                        const isOpen = expanded === idx;
                        return (
                            <TouchableOpacity
                                key={idx}
                                style={[styles.card, { backgroundColor: cardColor, shadowColor: isDarkTheme ? '#000' : '#d169e5' }]}
                                activeOpacity={0.95}
                                onPress={() => handleToggle(idx)}
                            >
                                <View style={styles.questionRow}>
                                    <Ionicons name={isOpen ? 'chevron-down' : 'chevron-forward'} size={22} color={primaryColor} style={{ marginRight: 8 }} />
                                    <Text style={[styles.question, { color: primaryColor }]}>{item.q}</Text>
                                </View>
                                {isOpen && (
                                    <Text style={[styles.answer, { color: textColor }]}>{item.a}</Text>
                                )}
                            </TouchableOpacity>
                        );
                    })
                )}
                <Text style={[styles.paragraph, { color: textColor, marginTop: 32, textAlign: 'center' }]}>Still have questions? Contact support!</Text>
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
    contentContainer: { padding: 24, paddingBottom: 40 },
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
        marginBottom: 8,
    },
    question: {
        fontSize: 17,
        fontWeight: 'bold',
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

export default KarmaFAQScreen;
