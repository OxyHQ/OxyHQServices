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
import type { BaseScreenProps } from '../../navigation/types';
import { useOxy } from '../../context/OxyContext';
import { fontFamilies } from '../../styles/fonts';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../../hooks/useI18n';

/**
 * Darkens a color by a specified factor
 * Returns a darker version of the color
 */
const darkenColor = (color: string, factor: number = 0.6): string => {
    // Remove # if present
    const hex = color.replace('#', '');

    // Convert to RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Darken by factor
    const newR = Math.max(0, Math.round(r * (1 - factor)));
    const newG = Math.max(0, Math.round(g * (1 - factor)));
    const newB = Math.max(0, Math.round(b * (1 - factor)));

    return `#${newR.toString(16).padStart(2, '0')}${newG.toString(16).padStart(2, '0')}${newB.toString(16).padStart(2, '0')}`;
};

const KarmaCenterScreen: React.FC<BaseScreenProps> = ({
    theme,
    navigate,
    goBack,
}) => {
    const { user, oxyServices, isAuthenticated } = useOxy();
    const { t } = useI18n();
    const [karmaTotal, setKarmaTotal] = useState<number | null>(null);
    const [karmaHistory, setKarmaHistory] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const secondaryBackgroundColor = isDarkTheme ? '#222222' : '#F5F5F5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';
    const primaryColor = '#d169e5';

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
            <View style={[styles.container, { backgroundColor }]}>
                <Text style={[styles.message, { color: textColor }]}>{t('common.status.notSignedIn') || 'Not signed in'}</Text>
            </View>
        );
    }

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContainer}>
                <View style={styles.walletHeader}>
                    <Text style={[styles.karmaAmount, { color: primaryColor }]}>{karmaTotal ?? 0}</Text>
                    <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>
                        {t('karma.center.balance') || 'Karma Balance'}
                    </Text>
                    <View style={styles.actionContainer}>
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaLeaderboard')}>
                                <View style={[styles.actionIcon, { backgroundColor: '#FFD700' }]}>
                                    <Ionicons name="trophy-outline" size={28} color={darkenColor('#FFD700')} />
                                </View>
                                <Text style={styles.actionLabel}>{t('karma.center.actions.leaderboard') || 'Leaderboard'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaRules')}>
                                <View style={[styles.actionIcon, { backgroundColor: '#007AFF' }]}>
                                    <Ionicons name="document-text-outline" size={28} color={darkenColor('#007AFF')} />
                                </View>
                                <Text style={styles.actionLabel}>{t('karma.center.actions.rules') || 'Rules'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('AboutKarma')}>
                                <View style={[styles.actionIcon, { backgroundColor: '#FFD700' }]}>
                                    <Ionicons name="star-outline" size={28} color={darkenColor('#FFD700')} />
                                </View>
                                <Text style={styles.actionLabel}>{t('karma.center.actions.about') || 'About'}</Text>
                            </TouchableOpacity>
                        </View>
                        <View style={styles.actionRow}>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaRewards')}>
                                <View style={[styles.actionIcon, { backgroundColor: '#FF9500' }]}>
                                    <Ionicons name="gift-outline" size={28} color={darkenColor('#FF9500')} />
                                </View>
                                <Text style={styles.actionLabel}>{t('karma.center.actions.rewards') || 'Rewards'}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaFAQ')}>
                                <View style={[styles.actionIcon, { backgroundColor: '#30D158' }]}>
                                    <Ionicons name="help-circle-outline" size={28} color={darkenColor('#30D158')} />
                                </View>
                                <Text style={styles.actionLabel}>{t('karma.center.actions.faq') || 'FAQ'}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                    <Text style={styles.infoText}>
                        {t('karma.center.info') || 'Karma can only be earned by positive actions in the Oxy Ecosystem. It cannot be sent or received directly.'}
                    </Text>
                </View>
                <Text style={[styles.sectionTitle, { color: textColor }]}>
                    {t('karma.center.history') || 'Karma History'}
                </Text>
                <View style={styles.historyContainer}>
                    {karmaHistory.length === 0 ? (
                        <Text style={{ color: textColor, textAlign: 'center', marginTop: 16 }}>
                            {t('karma.center.noHistory') || 'No karma history yet.'}
                        </Text>
                    ) : (
                        karmaHistory.map((entry: any) => (
                            <View key={entry.id} style={[styles.historyItem, { borderColor }]}>
                                <Text style={[styles.historyPoints, { color: entry.points > 0 ? primaryColor : '#D32F2F' }]}>
                                    {entry.points > 0 ? '+' : ''}{entry.points}
                                </Text>
                                <Text style={[styles.historyDesc, { color: textColor }]}>
                                    {entry.reason || (t('karma.center.noDescription') || 'No description')}
                                </Text>
                                <Text style={[styles.historyDate, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>
                                    {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''}
                                </Text>
                            </View>
                        ))
                    )}
                </View>
                {error && <Text style={{ color: '#D32F2F', marginTop: 16, textAlign: 'center' }}>{error}</Text>}
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
        fontFamily: fontFamilies.phudu,
    },
    karmaAmount: {
        fontSize: 48,
        fontWeight: 'bold',
        marginBottom: 4,
        fontFamily: fontFamilies.phudu,
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
        color: '#888',
    },
    infoText: {
        fontSize: 13,
        color: '#888',
        textAlign: 'center',
        marginTop: 8,
        marginBottom: 8,
        maxWidth: 320,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 12,
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
