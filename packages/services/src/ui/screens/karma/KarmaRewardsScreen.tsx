import type React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import type { BaseScreenProps } from '../../navigation/types';
import { Header } from '../../components';
import { useI18n } from '../../hooks/useI18n';

const KarmaRewardsScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const { t } = useI18n();
    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const primaryColor = '#d169e5';

    // Placeholder: In a real app, fetch rewards from API
    return (
        <View style={[styles.container, { backgroundColor }]}>
            <Header
                title={t('karma.rewards.title') || 'Karma Rewards'}
                subtitle={t('karma.rewards.subtitle') || 'Unlock special features and recognition'}
                theme={theme}
                onBack={goBack}
                elevation="subtle"
            />
            <ScrollView contentContainerStyle={styles.contentContainer}>
                <Text style={[styles.paragraph, { color: textColor }]}>
                    {t('karma.rewards.intro') || 'Unlock special features and recognition by earning karma!'}
                </Text>
                <View style={styles.rewardBox}>
                    <Text style={[styles.rewardTitle, { color: primaryColor }]}>
                        {t('karma.rewards.earlyAccess.title') || '🎉 Early Access'}
                    </Text>
                    <Text style={[styles.rewardDesc, { color: textColor }]}>
                        {t('karma.rewards.earlyAccess.desc') || 'Get early access to new features with 100+ karma.'}
                    </Text>
                </View>
                <View style={styles.rewardBox}>
                    <Text style={[styles.rewardTitle, { color: primaryColor }]}>
                        {t('karma.rewards.badge.title') || '🏅 Community Badge'}
                    </Text>
                    <Text style={[styles.rewardDesc, { color: textColor }]}>
                        {t('karma.rewards.badge.desc') || 'Earn a special badge for 500+ karma.'}
                    </Text>
                </View>
                <View style={styles.rewardBox}>
                    <Text style={[styles.rewardTitle, { color: primaryColor }]}>
                        {t('karma.rewards.featured.title') || '🌟 Featured Member'}
                    </Text>
                    <Text style={[styles.rewardDesc, { color: textColor }]}>
                        {t('karma.rewards.featured.desc') || 'Be featured in the community for 1000+ karma.'}
                    </Text>
                </View>
                <Text style={[styles.paragraph, { color: textColor, marginTop: 24 }]}>
                    {t('karma.rewards.moreComing') || 'More rewards coming soon!'}
                </Text>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    contentContainer: { padding: 24, paddingTop: 20 },
    rewardBox: {
        backgroundColor: '#f7eaff',
        borderRadius: 16,
        padding: 18,
        marginBottom: 18,
        ...Platform.select({
            web: {
                boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
            },
            default: {
                shadowColor: '#000',
                shadowOpacity: 0.04,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 4,
                elevation: 1,
            }
        }),
    },
    rewardTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 6 },
    rewardDesc: { fontSize: 15 },
    paragraph: { fontSize: 16, marginBottom: 12 },
});

export default KarmaRewardsScreen;
