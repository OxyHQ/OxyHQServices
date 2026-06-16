import type React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import type { ReputationRule } from '@oxyhq/core';
import type { BaseScreenProps } from '../../types/navigation';
import Header from '../../components/Header';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../../context/OxyContext';

const TrustRulesScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices } = useOxy();
    const { t } = useI18n();
    const [rules, setRules] = useState<ReputationRule[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const bloomTheme = useTheme();
    // Override primaryColor for Oxy Trust screens (purple instead of blue)
    const primaryColor = '#d169e5';

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        oxyServices.getReputationRules()
            .then((data) => setRules(Array.isArray(data) ? data : []))
            .catch((err: unknown) => setError((err instanceof Error ? err.message : null) || 'Failed to load rules'))
            .finally(() => setIsLoading(false));
    }, [oxyServices]);

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('trust.rules.title') || 'Trust Rules'}
                subtitle={t('trust.rules.subtitle') || 'How to earn reputation'}

                onBack={goBack}
                elevation="subtle"
            />
            {isLoading ? (
                <ActivityIndicator size="large" color={primaryColor} style={{ marginTop: 40 }} />
            ) : error ? (
                <Text style={[styles.error, { color: bloomTheme.colors.error }]}>{error}</Text>
            ) : (
                <ScrollView contentContainerStyle={styles.listContainer}>
                    {rules.length === 0 ? (
                        <Text style={[styles.placeholder, { color: bloomTheme.colors.text }]}>{t('trust.rules.empty') || 'No rules found.'}</Text>
                    ) : (
                        rules.map((rule) => (
                            <View key={rule.id} style={[styles.ruleRow, { borderColor: bloomTheme.colors.border }]}>
                                <View style={styles.ruleTextColumn}>
                                    <Text style={[styles.ruleDesc, { color: bloomTheme.colors.text }]}>{rule.description}</Text>
                                    <Text style={[styles.ruleCategory, { color: bloomTheme.colors.textTertiary }]}>{rule.category}</Text>
                                </View>
                                <Text style={[styles.rulePoints, { color: rule.points >= 0 ? primaryColor : bloomTheme.colors.error }]}>
                                    {rule.points > 0 ? '+' : ''}{rule.points}
                                </Text>
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
    listContainer: { paddingBottom: 40, paddingTop: 20 },
    ruleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 24,
        borderBottomWidth: 1,
        gap: 12,
    },
    ruleTextColumn: { flex: 1 },
    ruleDesc: { fontSize: 16 },
    ruleCategory: { fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
    rulePoints: { fontSize: 16, fontWeight: '700' },
    placeholder: { fontSize: 16, textAlign: 'center', marginTop: 40 },
    error: { fontSize: 16, textAlign: 'center', marginTop: 40 },
});

export default TrustRulesScreen;
