import type React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import type { BaseScreenProps } from '../../navigation/types';
import { Header } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import { useThemeStyles } from '../../hooks/useThemeStyles';

const KarmaRewardsScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const { t } = useI18n();
    const themeStyles = useThemeStyles(theme);
    const backgroundColor = themeStyles.backgroundColor;
    const textColor = themeStyles.textColor;
    const primaryColor = '#d169e5';

    // TODO: Implement API integration for rewards
    // Should fetch rewards from oxyServices.getKarmaRewards() instead of using static content
    return (
        <View style={[styles.container, { backgroundColor }]}>
            <Header
                title={t('karma.rewards.title') || 'Karma Rewards'}
                subtitle={t('karma.rewards.subtitle') || 'Unlock special features and recognition'}
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
