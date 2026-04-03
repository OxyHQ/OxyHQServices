import type React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import type { BaseScreenProps } from '../../types/navigation';
import { Header } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../../context/OxyContext';

const KarmaRulesScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices } = useOxy();
    const { t } = useI18n();
    const [rules, setRules] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const bloomTheme = useTheme();
    // Override primaryColor for Karma screens (purple instead of blue)
    const primaryColor = '#d169e5';

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        oxyServices.getKarmaRules()
            .then((data: any) => setRules(Array.isArray(data) ? data : []))
            .catch((err: unknown) => setError((err instanceof Error ? err.message : null) || 'Failed to load rules'))
            .finally(() => setIsLoading(false));
    }, [oxyServices]);

    return (
        <View style={styles.container} className="bg-background">
            <Header
                title={t('karma.rules.title') || 'Karma Rules'}
                subtitle={t('karma.rules.subtitle') || 'How to earn karma points'}
                
                onBack={goBack}
                elevation="subtle"
            />
            {isLoading ? (
                <ActivityIndicator size="large" color={primaryColor} style={{ marginTop: 40 }} />
            ) : error ? (
                <Text style={[styles.error, { color: '#D32F2F' }]}>{error}</Text>
            ) : (
                <ScrollView contentContainerStyle={styles.listContainer}>
                    {rules.length === 0 ? (
                        <Text style={[styles.placeholder, { color: bloomTheme.colors.text }]}>{t('karma.rules.empty') || 'No rules found.'}</Text>
                    ) : (
                        rules.map((rule, idx) => (
                            <View key={rule.id || idx} style={styles.ruleRow}>
                                <Text style={[styles.ruleDesc, { color: bloomTheme.colors.text }]}>{rule.description}</Text>
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
