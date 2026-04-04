import type React from 'react';
import { useEffect, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    Platform,
} from 'react-native';
import type { BaseScreenProps } from '../../types/navigation';
import { fontFamilies } from '../../styles/fonts';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColorScheme } from '../../hooks/useColorScheme';
import { Colors } from '../../constants/theme';
import { normalizeColorScheme } from '../../utils/themeUtils';
import { darkenColor } from '../../utils/colorUtils';
import { useOxy } from '../../context/OxyContext';

const KarmaCenterScreen: React.FC<BaseScreenProps> = ({
    theme,
    navigate,
    goBack,
}) => {
    // Use useOxy() hook for OxyContext values
    const { user, oxyServices, isAuthenticated } = useOxy();
    const { t } = useI18n();
    const [karmaTotal, setKarmaTotal] = useState<number | null>(null);
    const [karmaHistory, setKarmaHistory] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const bloomTheme = useTheme();
    const colorScheme = useColorScheme();
    const normalizedColorScheme = normalizeColorScheme(colorScheme);
    const themeColors = Colors[normalizedColorScheme];
    // Override primaryColor for Karma screens (purple instead of blue)
    const primaryColor = '#d169e5';
    const dangerColor = bloomTheme.colors.error || '#D32F2F';
    const mutedTextColor = bloomTheme.isDark ? '#BBBBBB' : '#888888';

    // Icon colors from theme
    const iconLeaderboard = themeColors.iconPayments;
    const iconRules = themeColors.iconSecurity;
    const iconAbout = themeColors.iconPayments;
    const iconRewards = themeColors.iconStorage;
    const iconFAQ = themeColors.iconPersonalInfo;

    useEffect(() => {
        if (!user) return;
        setIsLoading(true);
        setError(null);
        Promise.all([
            oxyServices.getUserKarmaTotal(user.id),
            oxyServices.getUserKarmaHistory(user.id, 20, 0),
        ])
            .then(([totalRes, historyRes]) => {
                setKarmaTotal(totalRes.total);
                setKarmaHistory(Array.isArray(historyRes.history) ? historyRes.history : []);
            })
            .catch((err) => {
                setError(err.message || 'Failed to load karma data');
            })
            .finally(() => setIsLoading(false));
    }, [user]);

    if (!isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
                <Text style={[styles.message, { color: bloomTheme.colors.text }]}>{t('common.status.notSignedIn') || 'Not signed in'}</Text>
            </View>
        );
    }

    if (isLoading) {
        return (
            <View style={[styles.container, { justifyContent: 'center', backgroundColor: bloomTheme.colors.background }]}>
                <ActivityIndicator size="large" color={primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer}>
                <View style={styles.walletHeader}>
                    <Text style={[styles.karmaAmount, { color: primaryColor }]}>{karmaTotal ?? 0}</Text>
                    <Text style={[styles.karmaLabel, { color: bloomTheme.isDark ? '#BBBBBB' : '#888888' }]}>
                        {t('karma.center.balance') || 'Karma Balance'}
                    </Text>
                    <View style={styles.actionContainer}>
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('KarmaLeaderboard')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconLeaderboard }]}>
                                    <Ionicons name="trophy-outline" size={28} color={darkenColor(iconLeaderboard)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('karma.center.actions.leaderboard') || 'Leaderboard'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('KarmaRules')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconRules }]}>
                                    <Ionicons name="document-text-outline" size={28} color={darkenColor(iconRules)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('karma.center.actions.rules') || 'Rules'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('AboutKarma')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconAbout }]}>
                                    <Ionicons name="star-outline" size={28} color={darkenColor(iconAbout)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('karma.center.actions.about') || 'About'}</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('KarmaRewards')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconRewards }]}>
                                    <Ionicons name="gift-outline" size={28} color={darkenColor(iconRewards)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('karma.center.actions.rewards') || 'Rewards'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('KarmaFAQ')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconFAQ }]}>
                                    <Ionicons name="help-circle-outline" size={28} color={darkenColor(iconFAQ)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('karma.center.actions.faq') || 'FAQ'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <Text style={[styles.infoText, { color: mutedTextColor }]}>
                        {t('karma.center.info') || 'Karma can only be earned by positive actions in the Oxy Ecosystem. It cannot be sent or received directly.'}
                    </Text>
                </View>
                <Text style={[styles.sectionTitle, { color: bloomTheme.colors.text }]}>
                    {t('karma.center.history') || 'Karma History'}
                </Text>
                <View style={styles.historyContainer}>
                    {karmaHistory.length === 0 ? (
                        <Text style={{ color: bloomTheme.colors.text, textAlign: 'center', marginTop: 16 }}>
                            {t('karma.center.noHistory') || 'No karma history yet.'}
                        </Text>
                    ) : (
                        karmaHistory.map((entry: any) => (
                            <View key={entry.id} style={[styles.historyItem, { borderColor: bloomTheme.colors.border }]}>
                                <Text style={[styles.historyPoints, { color: entry.points > 0 ? primaryColor : dangerColor }]}>
                                    {entry.points > 0 ? '+' : ''}{entry.points}
                                </Text>
                                <Text style={[styles.historyDesc, { color: bloomTheme.colors.text }]}>
                                    {entry.reason || (t('karma.center.noDescription') || 'No description')}
                                </Text>
                                <Text style={[styles.historyDate, { color: bloomTheme.isDark ? '#BBBBBB' : '#888888' }]}>
                                    {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}
                                </Text>
                            </View>
                        ))
                    )}
                </View>
                {error && <Text style={{ color: dangerColor, marginTop: 16, textAlign: 'center' }}>{error}</Text>}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    scrollContainer: {
        padding: 0,
        alignItems: 'center',
    },
    walletHeader: {
        alignItems: 'center',
        paddingTop: 36,
        paddingBottom: 24,
        width: '100%',
        backgroundColor: 'transparent',
    },
    karmaLabel: {
        fontSize: 16,
        marginBottom: 18,
        fontFamily: fontFamilies.inter,
    },
    karmaAmount: {
        fontSize: 48,
        fontWeight: 'bold',
        marginBottom: 4,
        fontFamily: fontFamilies.inter,
    },
    actionContainer: {
        marginBottom: 18,
        gap: 8,
    },
    actionRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 2,
    },
    actionIconWrapper: {
        alignItems: 'center',
        width: 72,
    },
    actionIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
    },
    actionIconText: {
        fontSize: 28,
    },
    actionLabel: {
        fontSize: 10,
    },
    infoText: {
        fontSize: 13,
        textAlign: 'center',
        marginTop: 8,
        marginBottom: 8,
        maxWidth: 320,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: Platform.OS === 'web' ? '600' : undefined,
        fontFamily: fontFamilies.interSemiBold,
        marginTop: 8,
        alignSelf: 'flex-start',
        marginLeft: 24,
    },
    historyContainer: {
        borderRadius: 15,
        overflow: 'hidden',
        marginBottom: 20,
        width: '100%',
        paddingHorizontal: 12,
    },
    historyItem: {
        padding: 14,
        borderBottomWidth: 1,
    },
    historyPoints: {
        fontSize: 16,
        fontWeight: '700',
    },
    historyDesc: {
        fontSize: 15,
        marginTop: 2,
    },
    historyDate: {
        fontSize: 13,
        marginTop: 2,
    },

    message: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 24,
    },
});

export default KarmaCenterScreen;
