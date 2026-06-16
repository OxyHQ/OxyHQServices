import type React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import type { BaseScreenProps } from '../../types/navigation';
import Header from '../../components/Header';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';

const TrustAboutScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const { t } = useI18n();
    const bloomTheme = useTheme();
    // Override primaryColor for Oxy Trust screens (purple instead of blue)
    const primaryColor = '#d169e5';

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('trust.about.title') || 'About Oxy Trust'}
                subtitle={t('trust.about.subtitle') || 'Learn about the reputation system'}

                onBack={goBack}
                elevation="subtle"
            />
            <ScrollView contentContainerStyle={styles.contentContainer}>
                <Text style={[styles.paragraph, { color: bloomTheme.colors.text }]}>
                    {t('trust.about.intro') || 'Oxy Trust is a recognition of your positive actions in the Oxy Ecosystem. Reputation cannot be sent or received directly, only earned by contributing to the community.'}
                </Text>
                <Text style={[styles.section, { color: primaryColor }]}>
                    {t('trust.about.how.title') || 'How to Earn Reputation'}
                </Text>
                <Text style={[styles.paragraph, { color: bloomTheme.colors.text }]}>
                    • {t('trust.about.how.help') || 'Helping other users'}{'\n'}
                    • {t('trust.about.how.report') || 'Reporting bugs'}{'\n'}
                    • {t('trust.about.how.contribute') || 'Contributing content'}{'\n'}
                    • {t('trust.about.how.participate') || 'Participating in events'}{'\n'}
                    • {t('trust.about.how.other') || 'Other positive actions'}
                </Text>
                <Text style={[styles.section, { color: primaryColor }]}>
                    {t('trust.about.why.title') || 'Why Oxy Trust?'}
                </Text>
                <Text style={[styles.paragraph, { color: bloomTheme.colors.text }]}>
                    {t('trust.about.why.text') || 'Your reputation and trust tier unlock special features and recognition in the Oxy Ecosystem. The more you contribute, the more you earn!'}
                </Text>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: {
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 54,
        margin: 24,
        marginBottom: 24,
    },
    contentContainer: { padding: 24, paddingTop: 20 },
    section: {
        fontSize: 18,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        marginTop: 24,
        marginBottom: 8
    },
    paragraph: { fontSize: 16, marginBottom: 12 },
});

export default TrustAboutScreen;
