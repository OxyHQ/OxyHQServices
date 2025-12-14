import type React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import type { BaseScreenProps } from '../../types/navigation';
import { Header } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { normalizeTheme } from '../../utils/themeUtils';
import { useColorScheme } from '../../hooks/use-color-scheme';

const KarmaAboutScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const normalizedTheme = normalizeTheme(theme);
    const themeStyles = useThemeStyles(normalizedTheme, colorScheme);
    // Override primaryColor for Karma screens (purple instead of blue)
    const primaryColor = '#d169e5';

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('karma.about.title') || 'About Karma'}
                subtitle={t('karma.about.subtitle') || 'Learn about the karma system'}
                
                onBack={goBack}
                elevation="subtle"
            />
            <ScrollView contentContainerStyle={styles.contentContainer}>
                <Text style={[styles.paragraph, { color: themeStyles.textColor }]}>
                    {t('karma.about.intro') || 'Karma is a recognition of your positive actions in the Oxy Ecosystem. It cannot be sent or received directly, only earned by contributing to the community.'}
                </Text>
                <Text style={[styles.section, { color: primaryColor }]}>
                    {t('karma.about.how.title') || 'How to Earn Karma'}
                </Text>
                <Text style={[styles.paragraph, { color: themeStyles.textColor }]}>
                    • {t('karma.about.how.help') || 'Helping other users'}{'\n'}
                    • {t('karma.about.how.report') || 'Reporting bugs'}{'\n'}
                    • {t('karma.about.how.contribute') || 'Contributing content'}{'\n'}
                    • {t('karma.about.how.participate') || 'Participating in events'}{'\n'}
                    • {t('karma.about.how.other') || 'Other positive actions'}
                </Text>
                <Text style={[styles.section, { color: primaryColor }]}>
                    {t('karma.about.why.title') || 'Why Karma?'}
                </Text>
                <Text style={[styles.paragraph, { color: themeStyles.textColor }]}>
                    {t('karma.about.why.text') || 'Karma unlocks special features and recognition in the Oxy Ecosystem. The more you contribute, the more you earn!'}
                </Text>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 54,
        margin: 24,
        marginBottom: 24,
    },
    contentContainer: { padding: 24, paddingTop: 20 },
    section: { fontSize: 18, fontWeight: 'bold', marginTop: 24, marginBottom: 8 },
    paragraph: { fontSize: 16, marginBottom: 12 },
});

export default KarmaAboutScreen;
