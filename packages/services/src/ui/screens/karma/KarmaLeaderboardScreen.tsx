import type React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import type { BaseScreenProps } from '../../navigation/types';
import { useOxy } from '../../context/OxyContext';
import Avatar from '../../components/Avatar';
import { Header } from '../../components';

const KarmaLeaderboardScreen: React.FC<BaseScreenProps> = ({ goBack, theme, navigate }) => {
    const { oxyServices } = useOxy();
    const [leaderboard, setLeaderboard] = useState<any[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const primaryColor = '#d169e5';

    useEffect(() => {
        setIsLoading(true);
        setError(null);
        oxyServices.getKarmaLeaderboard()
            .then((data: any) => setLeaderboard(Array.isArray(data) ? data : []))
            .catch((err: any) => setError(err.message || 'Failed to load leaderboard'))
            .finally(() => setIsLoading(false));
    }, [oxyServices]);

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <Header
                title="Karma Leaderboard"
                subtitle="Top contributors in the community"
                theme={theme}
                onBack={goBack}
                elevation="subtle"
            />
            {isLoading ? (
                <ActivityIndicator size="large" color={primaryColor} style={{ marginTop: 40 }} />
            ) : error ? (
                <Text style={[styles.error, { color: '#D32F2F' }]}>{error}</Text>
            ) : (
                <ScrollView contentContainerStyle={styles.listContainer}>
                    {leaderboard.length === 0 ? (
                        <Text style={[styles.placeholder, { color: textColor }]}>No leaderboard data.</Text>
                    ) : (
                        leaderboard.map((entry, idx) => (
                            <TouchableOpacity
                                key={entry.userId}
                                style={[styles.row, idx < 3 && { backgroundColor: '#f7eaff' }]}
                                onPress={() => navigate && navigate('KarmaProfile', { userId: entry.userId, username: entry.username })}
                                activeOpacity={0.7}
                            >
                                <Text style={[styles.rank, { color: primaryColor }]}>{idx + 1}</Text>
                                <Avatar name={entry.username || 'User'} size={40} theme={theme} style={styles.avatar} />
                                <Text style={[styles.username, { color: textColor }]}>{entry.username || entry.userId}</Text>
                                <Text style={[styles.karma, { color: primaryColor }]}>{entry.total}</Text>
                            </TouchableOpacity>
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
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
        borderColor: '#eee',
    },
    rank: { fontSize: 20, width: 32, textAlign: 'center', fontWeight: 'bold' },
    avatar: { marginHorizontal: 8 },
    username: { flex: 1, fontSize: 16, marginLeft: 8 },
    karma: { fontSize: 18, fontWeight: 'bold', marginLeft: 12 },
    placeholder: { fontSize: 16, color: '#888', textAlign: 'center', marginTop: 40 },
    error: { fontSize: 16, textAlign: 'center', marginTop: 40 },
});

export default KarmaLeaderboardScreen;
