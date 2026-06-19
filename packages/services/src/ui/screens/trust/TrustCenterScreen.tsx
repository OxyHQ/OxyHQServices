import type React from 'react';
import { useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Platform,
} from 'react-native';
import type { ReputationTransaction, TrustTier } from '@oxyhq/core';
import type { BaseScreenProps } from '../../types/navigation';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColorScheme } from '../../hooks/useColorScheme';
import { Colors } from '../../constants/theme';
import { normalizeColorScheme } from '@oxyhq/core';
import { darkenColor } from '../../utils/colorUtils';
import { useOxy } from '../../context/OxyContext';
import { getTrustTierLabel } from './trustTier';

const TrustCenterScreen: React.FC<BaseScreenProps> = ({
    theme,
    navigate,
    goBack,
}) => {
    // Use useOxy() hook for OxyContext values
    const { user, oxyServices, isAuthenticated } = useOxy();
    const { t } = useI18n();
    const [reputationTotal, setReputationTotal] = useState<number | null>(null);
    const [trustTier, setTrustTier] = useState<TrustTier | null>(null);
    const [transactions, setTransactions] = useState<ReputationTransaction[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const bloomTheme = useTheme();
    const colorScheme = useColorScheme();
    const normalizedColorScheme = normalizeColorScheme(colorScheme);
    const themeColors = Colors[normalizedColorScheme];
    // Override primaryColor for Oxy Trust screens (purple instead of blue)
    const primaryColor = '#d169e5';
    const dangerColor = bloomTheme.colors.error;
    const mutedTextColor = bloomTheme.colors.textTertiary;

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
            oxyServices.getReputationBalance(user.id),
            oxyServices.getReputationTransactions(user.id, 20, 0),
        ])
            .then(([balance, txns]) => {
                setReputationTotal(balance.total);
                setTrustTier(balance.trustTier);
                setTransactions(Array.isArray(txns) ? txns : []);
            })
            .catch((err: unknown) => {
                setError(
                    (err instanceof Error ? err.message : null) ||
                        (t('trust.center.loadError') || 'Failed to load reputation data'),
                );
            })
            .finally(() => setIsLoading(false));
    }, [user, oxyServices, t]);

    const trustTierLabel = useMemo(
        () => (trustTier ? getTrustTierLabel(trustTier, t) : null),
        [trustTier, t],
    );

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
                    <Text style={[styles.reputationAmount, { color: primaryColor }]}>{reputationTotal ?? 0}</Text>
                    <Text style={[styles.reputationLabel, { color: bloomTheme.colors.textTertiary }]}>
                        {t('trust.center.balance') || 'Reputation Balance'}
                    </Text>
                    {trustTierLabel && (
                        <View style={[styles.tierBadge, { borderColor: primaryColor }]}>
                            <Ionicons name="shield-checkmark-outline" size={14} color={primaryColor} />
                            <Text style={[styles.tierBadgeText, { color: primaryColor }]}>{trustTierLabel}</Text>
                        </View>
                    )}
                    <View style={styles.actionContainer}>
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('TrustLeaderboard')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconLeaderboard }]}>
                                    <Ionicons name="trophy-outline" size={28} color={darkenColor(iconLeaderboard)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('trust.center.actions.leaderboard') || 'Leaderboard'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('TrustRules')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconRules }]}>
                                    <Ionicons name="document-text-outline" size={28} color={darkenColor(iconRules)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('trust.center.actions.rules') || 'Rules'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('AboutTrust')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconAbout }]}>
                                    <Ionicons name="star-outline" size={28} color={darkenColor(iconAbout)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('trust.center.actions.about') || 'About'}</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('TrustRewards')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconRewards }]}>
                                    <Ionicons name="gift-outline" size={28} color={darkenColor(iconRewards)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('trust.center.actions.rewards') || 'Rewards'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate?.('TrustFAQ')}>
                                <View style={[styles.actionIcon, { backgroundColor: iconFAQ }]}>
                                    <Ionicons name="help-circle-outline" size={28} color={darkenColor(iconFAQ)} />
                                </View>
                                <Text style={[styles.actionLabel, { color: mutedTextColor }]}>{t('trust.center.actions.faq') || 'FAQ'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <Text style={[styles.infoText, { color: mutedTextColor }]}>
                        {t('trust.center.info') || 'Reputation can only be earned by positive actions in the Oxy Ecosystem. It cannot be sent or received directly.'}
                    </Text>
                </View>
                <Text style={[styles.sectionTitle, { color: bloomTheme.colors.text }]}>
                    {t('trust.center.history') || 'Reputation History'}
                </Text>
                <View style={styles.historyContainer}>
                    {transactions.length === 0 ? (
                        <Text style={{ color: bloomTheme.colors.text, textAlign: 'center', marginTop: 16 }}>
                            {t('trust.center.noHistory') || 'No reputation history yet.'}
                        </Text>
                    ) : (
                        transactions.map((entry) => (
                            <View key={entry.id} style={[styles.historyItem, { borderColor: bloomTheme.colors.border }]}>
                                <Text style={[styles.historyPoints, { color: entry.points > 0 ? primaryColor : dangerColor }]}>
                                    {entry.points > 0 ? '+' : ''}{entry.points}
                                </Text>
                                <Text style={[styles.historyDesc, { color: bloomTheme.colors.text }]}>
                                    {entry.reason || entry.actionType || (t('trust.center.noDescription') || 'No description')}
                                </Text>
                                <View style={styles.historyMetaRow}>
                                    <Text style={[styles.historyCategory, { color: primaryColor }]}>
                                        {entry.category}
                                    </Text>
                                    <Text style={[styles.historyDate, { color: bloomTheme.colors.textTertiary }]}>
                                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}
                                    </Text>
                                </View>
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
    reputationLabel: {
        fontSize: 16,
        marginBottom: 12,
    },
    reputationAmount: {
        fontSize: 48,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    tierBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 5,
        marginBottom: 18,
    },
    tierBadgeText: {
        fontSize: 13,
        fontWeight: '600',
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
    historyMetaRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 2,
    },
    historyCategory: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'capitalize',
    },
    historyDate: {
        fontSize: 13,
    },

    message: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 24,
    },
});

export default TrustCenterScreen;
