import type React from 'react';
import { useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import type { BaseScreenProps } from '../../types/navigation';
import { Header } from '../../components';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../hooks/useI18n';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { normalizeTheme, normalizeColorScheme } from '../../utils/themeUtils';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { Colors } from '../../constants/theme';
import { useOxy } from '../../context/OxyContext';
import { darkenColor, lightenColor } from '../../utils/colorUtils';

interface Achievement {
    id: string;
    name: string;
    description: string;
    category: 'milestone' | 'streak' | 'contribution' | 'special';
    icon: string;
    iconColor: string;
    unlocked: boolean;
    unlockedDate?: string;
    rarity: 'common' | 'rare' | 'epic' | 'legendary';
}

const KarmaRewardsScreen: React.FC<BaseScreenProps> = ({ goBack, theme }) => {
    const { t } = useI18n();
    const { user, oxyServices, isAuthenticated } = useOxy();
    const [karmaTotal, setKarmaTotal] = useState<number>(0);
    const [isLoading, setIsLoading] = useState(true);

    const normalizedTheme = normalizeTheme(theme);
    const baseThemeStyles = useThemeStyles(normalizedTheme);
    const colorScheme = useColorScheme();
    const normalizedColorScheme = normalizeColorScheme(colorScheme);
    const colors = Colors[normalizedColorScheme];
    const themeStyles = useMemo(() => ({
        ...baseThemeStyles,
        primaryColor: '#d169e5',
    }), [baseThemeStyles]);

    useEffect(() => {
        if (!user || !isAuthenticated) {
            setIsLoading(false);
            return;
        }
        setIsLoading(true);
        oxyServices.getUserKarmaTotal(user.id)
            .then((data: any) => {
                setKarmaTotal(data.total || 0);
            })
            .catch(() => {
                setKarmaTotal(0);
            })
            .finally(() => setIsLoading(false));
    }, [user, isAuthenticated, oxyServices]);

    const achievements: Achievement[] = useMemo(() => [
        {
            id: 'first-step',
            name: t('karma.achievements.firstStep') || 'First Step',
            description: t('karma.achievements.firstStepDesc') || 'Earned your first karma point',
            category: 'milestone',
            icon: 'footsteps',
            iconColor: '#8E8E93',
            unlocked: karmaTotal >= 1,
            rarity: 'common',
        },
        {
            id: 'novice',
            name: t('karma.achievements.novice') || 'Novice',
            description: t('karma.achievements.noviceDesc') || 'Reached 10 karma points',
            category: 'milestone',
            icon: 'leaf',
            iconColor: '#34C759',
            unlocked: karmaTotal >= 10,
            rarity: 'common',
        },
        {
            id: 'contributor',
            name: t('karma.achievements.contributor') || 'Contributor',
            description: t('karma.achievements.contributorDesc') || 'Reached 50 karma points',
            category: 'contribution',
            icon: 'people',
            iconColor: '#007AFF',
            unlocked: karmaTotal >= 50,
            rarity: 'common',
        },
        {
            id: 'rising-star',
            name: t('karma.achievements.risingStar') || 'Rising Star',
            description: t('karma.achievements.risingStarDesc') || 'Reached 100 karma points',
            category: 'milestone',
            icon: 'star',
            iconColor: '#FF9500',
            unlocked: karmaTotal >= 100,
            rarity: 'rare',
        },
        {
            id: 'early-adopter',
            name: t('karma.achievements.earlyAdopter') || 'Early Adopter',
            description: t('karma.achievements.earlyAdopterDesc') || 'Been part of the community from the start',
            category: 'special',
            icon: 'rocket',
            iconColor: '#AF52DE',
            unlocked: karmaTotal >= 200,
            rarity: 'rare',
        },
        {
            id: 'community-hero',
            name: t('karma.achievements.communityHero') || 'Community Hero',
            description: t('karma.achievements.communityHeroDesc') || 'Reached 500 karma points',
            category: 'contribution',
            icon: 'shield',
            iconColor: '#FF2D55',
            unlocked: karmaTotal >= 500,
            rarity: 'epic',
        },
        {
            id: 'legend',
            name: t('karma.achievements.legend') || 'Legend',
            description: t('karma.achievements.legendDesc') || 'Reached 1000 karma points',
            category: 'milestone',
            icon: 'trophy',
            iconColor: '#FFD700',
            unlocked: karmaTotal >= 1000,
            rarity: 'legendary',
        },
        {
            id: 'phoenix',
            name: t('karma.achievements.phoenix') || 'Phoenix',
            description: t('karma.achievements.phoenixDesc') || 'Reached 2500 karma points',
            category: 'milestone',
            icon: 'flame',
            iconColor: '#FF3B30',
            unlocked: karmaTotal >= 2500,
            rarity: 'legendary',
        },
        {
            id: 'unstoppable',
            name: t('karma.achievements.unstoppable') || 'Unstoppable',
            description: t('karma.achievements.unstoppableDesc') || 'Reached 5000 karma points',
            category: 'milestone',
            icon: 'infinite',
            iconColor: '#5E5CE6',
            unlocked: karmaTotal >= 5000,
            rarity: 'legendary',
        },
        {
            id: 'bug-hunter',
            name: t('karma.achievements.bugHunter') || 'Bug Hunter',
            description: t('karma.achievements.bugHunterDesc') || 'Reported helpful bugs',
            category: 'contribution',
            icon: 'bug',
            iconColor: '#FF9500',
            unlocked: false, // TODO: Check actual bug reports
            rarity: 'rare',
        },
        {
            id: 'helper',
            name: t('karma.achievements.helper') || 'Helper',
            description: t('karma.achievements.helperDesc') || 'Helped 10 users',
            category: 'contribution',
            icon: 'hand-left',
            iconColor: '#34C759',
            unlocked: false, // TODO: Check help actions
            rarity: 'common',
        },
        {
            id: 'streak-master',
            name: t('karma.achievements.streakMaster') || 'Streak Master',
            description: t('karma.achievements.streakMasterDesc') || '7 day activity streak',
            category: 'streak',
            icon: 'flash',
            iconColor: '#FFD700',
            unlocked: false, // TODO: Check streak
            rarity: 'epic',
        },
    ], [t, karmaTotal, colors]);

    const unlockedAchievements = achievements.filter(a => a.unlocked);
    const lockedAchievements = achievements.filter(a => !a.unlocked);

    const getRarityColor = (rarity: Achievement['rarity']) => {
        switch (rarity) {
            case 'legendary':
                return '#FFD700';
            case 'epic':
                return '#AF52DE';
            case 'rare':
                return '#007AFF';
            default:
                return '#8E8E93';
        }
    };

    const getAchievementValue = (achievement: Achievement): number | null => {
        // Extract numeric value from achievement based on ID and unlocked state
        const valueMap: Record<string, number> = {
            'first-step': 1,
            'novice': 10,
            'contributor': 50,
            'rising-star': 100,
            'early-adopter': 200,
            'community-hero': 500,
            'legend': 1000,
            'phoenix': 2500,
            'unstoppable': 5000,
            'helper': 10,
            'streak-master': 7,
        };
        return valueMap[achievement.id] || null;
    };

    const renderAchievement = (achievement: Achievement) => {
        const rarityColor = getRarityColor(achievement.rarity);
        const isLocked = !achievement.unlocked;
        const achievementValue = getAchievementValue(achievement);

        // Two-tone colors: darker for borders/shadow, lighter for highlights
        // Use achievement iconColor for unlocked badges, gray for locked
        const baseColor = isLocked ? '#8E8E93' : (achievement.iconColor || '#8E8E93');
        const darkTone = darkenColor(baseColor, 0.45); // Darker border/shadow (more contrast)
        const lightTone = lightenColor(baseColor, 0.25); // Lighter highlight
        const mediumTone = baseColor; // Base color

        return (
            <View
                key={achievement.id}
                style={[
                    styles.achievementCard,
                    {
                        backgroundColor: colors.card,
                    },
                ]}
            >
                <View style={styles.badgeContainer}>
                    {/* Outer glow effect - larger and softer */}
                    {!isLocked && (
                        <View
                            style={[
                                styles.badgeGlow,
                                styles.badgeOrganic,
                                {
                                    backgroundColor: darkTone,
                                    opacity: 0.3,
                                },
                            ]}
                        />
                    )}

                    {/* Main badge with two-tone effect */}
                    <View
                        style={[
                            styles.badgeMain,
                            styles.badgeOrganic,
                            {
                                backgroundColor: isLocked ? '#E5E5EA' : mediumTone,
                                borderColor: darkTone,
                                borderWidth: 5,
                                shadowColor: darkTone,
                            },
                        ]}
                    >
                        {/* Gradient-like highlight layer (lighter tone on top half) */}
                        {!isLocked && (
                            <>
                                <View
                                    style={[
                                        styles.badgeHighlight,
                                        {
                                            backgroundColor: lightTone,
                                        },
                                    ]}
                                />
                                {/* Additional highlight for more depth */}
                                <View
                                    style={[
                                        styles.badgeHighlightAccent,
                                        {
                                            backgroundColor: lightenColor(lightTone, 0.1),
                                        },
                                    ]}
                                />
                            </>
                        )}

                        {/* Icon container - positioned in upper area */}
                        <View style={styles.badgeIconContainer}>
                            {isLocked ? (
                                <Ionicons name="lock-closed" size={40} color="#8E8E93" />
                            ) : (
                                <Ionicons name={achievement.icon as any} size={40} color="#FFFFFF" />
                            )}
                        </View>

                        {/* Achievement value number - large and prominent at bottom */}
                        {achievementValue !== null && !isLocked && (
                            <View style={styles.badgeValueContainer}>
                                <Text
                                    style={[
                                        styles.badgeValueText,
                                        {
                                            color: lightTone,
                                            textShadowColor: darkTone,
                                        },
                                    ]}
                                >
                                    {achievementValue}
                                </Text>
                            </View>
                        )}
                    </View>

                    {/* Rarity badge - small accent in corner */}
                    {achievement.unlocked && (
                        <View style={[styles.rarityBadge, { backgroundColor: rarityColor, borderColor: darkenColor(rarityColor, 0.4) }]}>
                            <Text style={styles.rarityText}>{achievement.rarity[0].toUpperCase()}</Text>
                        </View>
                    )}
                </View>

                <Text style={[styles.achievementName, { color: themeStyles.textColor, opacity: isLocked ? 0.5 : 1 }]}>
                    {achievement.name}
                </Text>
                <Text style={[styles.achievementDescription, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#888888', opacity: isLocked ? 0.5 : 1 }]}>
                    {achievement.description}
                </Text>
            </View>
        );
    };

    if (!isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Header
                    title={t('karma.rewards.title') || 'Karma Rewards'}
                    subtitle={t('karma.rewards.subtitle') || 'Unlock special features and recognition'}
                    onBack={goBack}
                    elevation="subtle"
                />
                <View style={styles.centerContent}>
                    <Text style={[styles.message, { color: themeStyles.textColor }]}>
                        {t('common.status.notSignedIn') || 'Not signed in'}
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('karma.rewards.title') || 'Karma Rewards'}
                subtitle={t('karma.rewards.subtitle') || 'Unlock special features and recognition'}
                onBack={goBack}
                elevation="subtle"
            />
            <ScrollView
                contentContainerStyle={styles.contentContainer}
                showsVerticalScrollIndicator={false}
            >
                {/* Stats Header */}
                <View style={[styles.statsCard, { backgroundColor: colors.card }]}>
                    <View style={styles.statsHeader}>
                        <View>
                            <Text style={[styles.currentKarma, { color: themeStyles.primaryColor }]}>
                                {karmaTotal}
                            </Text>
                            <Text style={[styles.karmaLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#888888' }]}>
                                {t('karma.center.balance') || 'Karma Points'}
                            </Text>
                        </View>
                        <View style={styles.achievementStats}>
                            <Text style={[styles.achievementCount, { color: themeStyles.primaryColor }]}>
                                {unlockedAchievements.length}
                            </Text>
                            <Text style={[styles.achievementCountLabel, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#888888' }]}>
                                {t('karma.achievements.unlocked') || 'Achievements'}
                            </Text>
                        </View>
                    </View>
                    <View style={styles.progressBarContainer}>
                        <View style={[styles.progressBar, { backgroundColor: themeStyles.borderColor }]}>
                            <View
                                style={[
                                    styles.progressBarFill,
                                    {
                                        width: `${(unlockedAchievements.length / achievements.length) * 100}%`,
                                        backgroundColor: themeStyles.primaryColor,
                                    },
                                ]}
                            />
                        </View>
                        <Text style={[styles.progressText, { color: themeStyles.isDarkTheme ? '#BBBBBB' : '#888888' }]}>
                            {unlockedAchievements.length} / {achievements.length}
                        </Text>
                    </View>
                </View>

                {/* Unlocked Achievements */}
                {unlockedAchievements.length > 0 && (
                    <>
                        <Text style={[styles.sectionTitle, { color: themeStyles.textColor }]}>
                            {t('karma.achievements.unlocked') || 'Unlocked Achievements'}
                        </Text>
                        <View style={styles.achievementsGrid}>
                            {unlockedAchievements.map(achievement => renderAchievement(achievement))}
                        </View>
                    </>
                )}

                {/* Locked Achievements */}
                {lockedAchievements.length > 0 && (
                    <>
                        <Text style={[styles.sectionTitle, { color: themeStyles.textColor }]}>
                            {t('karma.achievements.locked') || 'Locked Achievements'}
                        </Text>
                        <View style={styles.achievementsGrid}>
                            {lockedAchievements.map(achievement => renderAchievement(achievement))}
                        </View>
                    </>
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    contentContainer: {
        paddingHorizontal: 24,
        paddingTop: 20,
        paddingBottom: 40,
    },
    centerContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
    },
    statsCard: {
        borderRadius: 18,
        padding: 20,
        marginBottom: 24,
    },
    statsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    currentKarma: {
        fontSize: 36,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    achievementStats: {
        alignItems: 'flex-end',
    },
    achievementCount: {
        fontSize: 36,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    achievementCountLabel: {
        fontSize: 14,
    },
    karmaLabel: {
        fontSize: 14,
    },
    progressBarContainer: {
        marginTop: 8,
    },
    progressBar: {
        height: 8,
        borderRadius: 4,
        overflow: 'hidden',
        marginBottom: 8,
    },
    progressBarFill: {
        height: '100%',
        borderRadius: 4,
    },
    progressText: {
        fontSize: 12,
        textAlign: 'right',
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 16,
        marginTop: 8,
    },
    achievementsGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 20,
        marginBottom: 24,
        justifyContent: 'space-between',
    },
    achievementCard: {
        width: '47%',
        minWidth: 140,
        borderRadius: 20,
        padding: 20,
        paddingTop: 24,
        alignItems: 'center',
    },
    badgeContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
        position: 'relative',
        width: 120,
        height: 120,
    },
    badgeGlow: {
        position: 'absolute',
        width: 135,
        height: 135,
        borderRadius: 67.5,
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 15,
        shadowOpacity: 0.4,
        elevation: 10,
    },
    badgeOrganic: {
        width: 120,
        height: 120,
        // More organic blob shape with varied border radius (like Duolingo)
        borderTopLeftRadius: 48,
        borderTopRightRadius: 52,
        borderBottomLeftRadius: 52,
        borderBottomRightRadius: 48,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeMain: {
        position: 'absolute',
        shadowOffset: { width: 0, height: 6 },
        shadowRadius: 12,
        shadowOpacity: 0.5,
        elevation: 8,
    },
    badgeHighlight: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '50%',
        borderTopLeftRadius: 48,
        borderTopRightRadius: 52,
        opacity: 0.6,
    },
    badgeHighlightAccent: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: '30%',
        borderTopLeftRadius: 48,
        borderTopRightRadius: 52,
        opacity: 0.3,
    },
    badgeIconContainer: {
        position: 'absolute',
        top: 8,
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'flex-start',
        zIndex: 10,
        paddingTop: 12,
    },
    badgeValueContainer: {
        position: 'absolute',
        bottom: 8,
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10,
    },
    badgeValueText: {
        fontSize: 32,
        fontWeight: 'bold',
        textShadowOffset: { width: 0, height: 2 },
        textShadowRadius: 4,
        letterSpacing: -1,
    },
    rarityBadge: {
        position: 'absolute',
        top: -6,
        right: -6,
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.4,
        shadowRadius: 4,
        elevation: 5,
    },
    rarityText: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#FFFFFF',
    },
    achievementName: {
        fontSize: 15,
        fontWeight: '700',
        textAlign: 'center',
        marginBottom: 6,
        marginTop: 4,
    },
    achievementDescription: {
        fontSize: 11,
        textAlign: 'center',
        lineHeight: 15,
    },
});

export default KarmaRewardsScreen;
