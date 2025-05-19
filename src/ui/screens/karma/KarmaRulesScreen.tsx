import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { BaseScreenProps } from '../../navigation/types';
import { useOxy } from '../../context/OxyContext';

const KarmaRulesScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const { oxyServices } = useOxy();
    const [rules, setRules] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const primaryColor = '#d169e5';

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        oxyServices.getKarmaRules()
            .then((data) => setRules(Array.isArray(data) ? data : []))
            .catch((err) => setError(err.message || 'Failed to load rules'))
            .finally(() => setIsLoading(false));
    }, [oxyServices]);

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <Text style={[styles.title, { color: textColor }]}>Karma Rules</Text>
            {isLoading ? (
                <ActivityIndicator size="large" color={primaryColor} style={{ marginTop: 40 }} />
            ) : error ? (
                <Text style={[styles.error, { color: '#D32F2F' }]}>{error}</Text>
            ) : (
                <ScrollView contentContainerStyle={styles.listContainer}>
                    {rules.length === 0 ? (
                        <Text style={[styles.placeholder, { color: textColor }]}>No rules found.</Text>
                    ) : (
                        rules.map((rule, idx) => (
                            <View key={rule.id || idx} style={styles.ruleRow}>
                                <Text style={[styles.ruleDesc, { color: textColor }]}>{rule.description}</Text>
                            </View>
                        ))
                    )}
                </ScrollView>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: { fontSize: 24, fontWeight: 'bold', margin: 24, textAlign: 'center' },
    listContainer: { paddingBottom: 40 },
    ruleRow: {
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderBottomWidth: 1,
        borderColor: '#eee',
    },
    ruleDesc: { fontSize: 16 },
    placeholder: { fontSize: 16, color: '#888', textAlign: 'center', marginTop: 40 },
    error: { fontSize: 16, textAlign: 'center', marginTop: 40 },
});

export default KarmaRulesScreen;
