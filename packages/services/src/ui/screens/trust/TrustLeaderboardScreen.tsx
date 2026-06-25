import type React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import type { ReputationLeaderboardEntry } from '@oxyhq/core';
import type { BaseScreenProps } from '../../types/navigation';
import Avatar from '../../components/Avatar';
import Header from '../../components/Header';
import { useI18n } from '../../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../../context/OxyContext';
import { getTrustTierLabel } from './trustTier';

const TrustLeaderboardScreen: React.FC<BaseScreenProps> = ({ goBack, theme, navigate }) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices } = useOxy();
    const { t } = useI18n();
    const [leaderboard, setLeaderboard] = useState<ReputationLeaderboardEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const bloomTheme = useTheme();
    const primaryColor = bloomTheme.colors.primary;

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        oxyServices.getReputationLeaderboard()
            .then((data) => setLeaderboard(Array.isArray(data) ? data : []))
            .catch((err: unknown) => setError((err instanceof Error ? err.message : null) || 'Failed to load leaderboard'))
            .finally(() => setIsLoading(false));
    }, [oxyServices]);

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('trust.leaderboard.title') || 'Trust Leaderboard'}
                subtitle={t('trust.leaderboard.subtitle') || 'Top contributors in the community'}

                onBack={goBack}
                elevation="subtle"
            />
            {isLoading ? (
                <ActivityIndicator size="large" color={primaryColor} style={{ marginTop: 40 }} />
            ) : error ? (
                <Text style={[styles.error, { color: bloomTheme.colors.error }]}>{error}</Text>
            ) : (
                <ScrollView contentContainerStyle={styles.listContainer}>
                    {leaderboard.length === 0 ? (
                        <Text style={[styles.placeholder, { color: bloomTheme.colors.text }]}>{t('trust.leaderboard.empty') || 'No leaderboard data.'}</Text>
                    ) : (
                        leaderboard.map((entry) => {
                            const username = entry.user.username;
                            const displayName = username || entry.user.id;
                            return (
                                <TouchableOpacity
                                    key={entry.user.id}
                                    style={[styles.row, { borderColor: bloomTheme.colors.border }, entry.rank <= 3 && { backgroundColor: bloomTheme.colors.primarySubtle }]}
                                    onPress={() => navigate?.('Profile', { userId: entry.user.id, username })}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.rank, { color: primaryColor }]}>{entry.rank}</Text>
                                    <Avatar name={username || 'User'} size={40} style={styles.avatar} />
                                    <View style={styles.userColumn}>
                                        <Text style={[styles.username, { color: bloomTheme.colors.text }]} numberOfLines={1}>{displayName}</Text>
                                        <Text style={[styles.tier, { color: bloomTheme.colors.textTertiary }]} numberOfLines={1}>
                                            {getTrustTierLabel(entry.trustTier, t)}
                                        </Text>
                                    </View>
                                    <Text style={[styles.reputation, { color: primaryColor }]}>{entry.total}</Text>
                                </TouchableOpacity>
                            );
                        })
                    )}
                </ScrollView>
            )}
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    listContainer: { paddingBottom: 40, paddingTop: 20 },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
    },
    rank: { fontSize: 20, width: 32, textAlign: 'center', fontWeight: 'bold' },
    avatar: { marginHorizontal: 8 },
    userColumn: { flex: 1, marginLeft: 8 },
    username: { fontSize: 16 },
    tier: { fontSize: 12, marginTop: 1 },
    reputation: { fontSize: 18, fontWeight: 'bold', marginLeft: 12 },
    placeholder: { fontSize: 16, textAlign: 'center', marginTop: 40 },
    error: { fontSize: 16, textAlign: 'center', marginTop: 40 },
});

export default TrustLeaderboardScreen;
