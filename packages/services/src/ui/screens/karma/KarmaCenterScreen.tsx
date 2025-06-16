import React, { useEffect, useState } from 'react';
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
import { BaseScreenProps } from '../../navigation/types';
import { useOxy } from '../../context/OxyContext';
import { fontFamilies } from '../../styles/fonts';
import Avatar from '../../components/Avatar';
import { Ionicons } from '../../../lib/icons';

const KarmaCenterScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
    goBack,
}) => {
    const { user, oxyServices } = useOxy();
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

    if (!user) {
        return (
            <View style={[styles.container, { backgroundColor }]}>
                <Text style={[styles.message, { color: textColor }]}>Not signed in</Text>
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
                    <Avatar
                        uri={user.avatar?.url}
                        name={user.username}
                        size={60}
                        theme={theme}
                        style={styles.avatar}
                    />
                    <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Karma Balance</Text>
                    <Text style={[styles.karmaAmount, { color: primaryColor }]}>{karmaTotal ?? 0}</Text>
                    <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaLeaderboard')}>
                            <View style={[styles.actionIcon, { backgroundColor: '#E0E0E0' }]}>
                                <Ionicons name="trophy-outline" size={28} color="#888" />
                            </View>
                            <Text style={styles.actionLabel}>Leaderboard</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaRules')}>
                            <View style={[styles.actionIcon, { backgroundColor: '#E0E0E0' }]}>
                                <Ionicons name="document-text-outline" size={28} color="#888" />
                            </View>
                            <Text style={styles.actionLabel}>Rules</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('AboutKarma')}>
                            <View style={[styles.actionIcon, { backgroundColor: '#E0E0E0' }]}>
                                <Ionicons name="star-outline" size={28} color="#888" />
                            </View>
                            <Text style={styles.actionLabel}>About</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaRewards')}>
                            <View style={[styles.actionIcon, { backgroundColor: '#E0E0E0' }]}>
                                <Ionicons name="gift-outline" size={28} color="#888" />
                            </View>
                            <Text style={styles.actionLabel}>Rewards</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.actionIconWrapper} onPress={() => navigate && navigate('KarmaFAQ')}>
                            <View style={[styles.actionIcon, { backgroundColor: '#E0E0E0' }]}>
                                <Ionicons name="help-circle-outline" size={28} color="#888" />
                            </View>
                            <Text style={styles.actionLabel}>FAQ</Text>
                        </TouchableOpacity>
                    </View>
                    <Text style={styles.infoText}>Karma can only be earned by positive actions in the Oxy Ecosystem. It cannot be sent or received directly.</Text>
                </View>
                <Text style={[styles.sectionTitle, { color: textColor }]}>Karma History</Text>
                <View style={styles.historyContainer}>
                    {karmaHistory.length === 0 ? (
                        <Text style={{ color: textColor, textAlign: 'center', marginTop: 16 }}>No karma history yet.</Text>
                    ) : (
                        karmaHistory.map((entry: any) => (
                            <View key={entry.id} style={[styles.historyItem, { borderColor }]}>
                                <Text style={[styles.historyPoints, { color: entry.points > 0 ? primaryColor : '#D32F2F' }]}>
                                    {entry.points > 0 ? '+' : ''}{entry.points}
                                </Text>
                                <Text style={[styles.historyDesc, { color: textColor }]}>
                                    {entry.reason || 'No description'}
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
            <View style={styles.footer}>
                <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                    <Text style={[styles.closeButtonText, { color: primaryColor }]}>Close</Text>
                </TouchableOpacity>
            </View>
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
    avatar: {
        marginBottom: 12,
    },
    karmaLabel: {
        fontSize: 16,
        marginBottom: 4,
        fontFamily: fontFamilies.phudu,
    },
    karmaAmount: {
        fontSize: 48,
        fontWeight: 'bold',
        marginBottom: 18,
        fontFamily: fontFamilies.phuduBold,
    },
    actionRow: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 18,
        flexWrap: 'wrap',
        rowGap: 0,
        columnGap: 0,
    },
    actionIconWrapper: {
        alignItems: 'center',
        marginHorizontal: 8,
        marginVertical: 4,
        width: 72,
    },
    actionIcon: {
        width: 56,
        height: 56,
        borderRadius: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 6,
        opacity: 0.5,
    },
    actionIconText: {
        fontSize: 28,
    },
    actionLabel: {
        fontSize: 13,
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
    footer: {
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#E0E0E0',
        alignItems: 'center',
    },
    closeButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
    },
    closeButtonText: {
        fontSize: 16,
        fontWeight: '600',
    },
    message: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 24,
    },
});

export default KarmaCenterScreen;
