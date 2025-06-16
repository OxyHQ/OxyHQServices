import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import { Ionicons } from '../../lib/icons';

interface ProfileScreenProps extends BaseScreenProps {
    userId: string;
    username?: string;
}

const ProfileScreen: React.FC<ProfileScreenProps> = ({ userId, username, theme, goBack }) => {
    const { oxyServices } = useOxy();
    const [profile, setProfile] = useState<any>(null);
    const [karmaTotal, setKarmaTotal] = useState<number | null>(null);
    const [postsCount, setPostsCount] = useState<number | null>(null);
    const [commentsCount, setCommentsCount] = useState<number | null>(null);
    const [followersCount, setFollowersCount] = useState<number | null>(null);
    const [followingCount, setFollowingCount] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const primaryColor = '#d169e5';

    useEffect(() => {
        setIsLoading(true);
        setError(null);

        // Load user profile and available data
        Promise.all([
            oxyServices.getUserById(userId),
            oxyServices.getUserKarmaTotal(userId).catch(() => ({ total: null })),
            oxyServices.getUserFollowers(userId, 1, 0).catch(() => ({ total: 0 })),
            oxyServices.getUserFollowing(userId, 1, 0).catch(() => ({ total: 0 }))
        ])
            .then(([profileRes, karmaRes, followersRes, followingRes]) => {
                setProfile(profileRes);
                setKarmaTotal(karmaRes.total);
                setFollowersCount(followersRes.total);
                setFollowingCount(followingRes.total);

                // For posts and comments, we'll show null until specific APIs are available
                // These could be added when content management APIs are implemented
                setPostsCount(null);
                setCommentsCount(null);
            })
            .catch((err: any) => setError(err.message || 'Failed to load profile'))
            .finally(() => setIsLoading(false));
    }, [userId]);

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
            </View>
        );
    }

    if (error) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <Text style={{ color: '#D32F2F', textAlign: 'center' }}>{error}</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor }]}>
            <ScrollView contentContainerStyle={styles.scrollContainer}>
                {/* Banner Image */}
                <View style={styles.bannerContainer}>
                    <View style={styles.bannerImage} />
                </View>
                {/* Avatar overlapping banner */}
                <View style={styles.avatarRow}>
                    <View style={styles.avatarWrapper}>
                        <Avatar uri={profile?.avatar?.url} name={profile?.username || username} size={96} theme={theme} />
                    </View>
                    {/* Edit Profile/Follow Button placeholder */}
                    <View style={styles.actionButtonWrapper}>
                        <Text style={styles.actionButton}>Edit Profile</Text>
                    </View>
                </View>
                {/* Profile Info */}
                <View style={styles.header}>
                    <Text style={[styles.displayName, { color: textColor }]}>{profile?.displayName || profile?.username || username || profile?.id}</Text>
                    {profile?.username && (
                        <Text style={[styles.subText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>@{profile.username}</Text>
                    )}
                    {/* Bio placeholder */}
                    <Text style={[styles.bio, { color: textColor }]}>{profile?.bio || 'This user has no bio yet.'}</Text>
                    {/* Email and Join Date Row */}
                    <View style={styles.infoRow}>
                        {profile?.email && (
                            <View style={styles.infoItem}>
                                <Ionicons name="mail-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 4 }} />
                                <Text style={[styles.infoText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>{profile.email}</Text>
                            </View>
                        )}
                        {profile?.createdAt && (
                            <View style={styles.infoItem}>
                                <Ionicons name="calendar-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 4 }} />
                                <Text style={[styles.infoText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Joined {new Date(profile.createdAt).toLocaleDateString()}</Text>
                            </View>
                        )}
                    </View>
                    {/* Divider */}
                    <View style={styles.divider} />
                    {/* All Stats in one row */}
                    <View style={styles.statsRow}>
                        <View style={styles.statItem}>
                            <Text style={[styles.karmaAmount, { color: primaryColor }]}>{karmaTotal !== null && karmaTotal !== undefined ? karmaTotal : '--'}</Text>
                            <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Karma</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={[styles.karmaAmount, { color: textColor }]}>{followersCount !== null ? followersCount : '--'}</Text>
                            <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Followers</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={[styles.karmaAmount, { color: textColor }]}>{followingCount !== null ? followingCount : '--'}</Text>
                            <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Following</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={[styles.karmaAmount, { color: textColor }]}>{postsCount !== null ? postsCount : '--'}</Text>
                            <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Posts</Text>
                        </View>
                        <View style={styles.statItem}>
                            <Text style={[styles.karmaAmount, { color: textColor }]}>{commentsCount !== null ? commentsCount : '--'}</Text>
                            <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Comments</Text>
                        </View>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollContainer: { alignItems: 'stretch', paddingBottom: 40 },
    bannerContainer: { height: 160, backgroundColor: '#e1bee7', position: 'relative', overflow: 'hidden' },
    bannerImage: { flex: 1, backgroundColor: '#d169e5' }, // Placeholder, replace with Image if available
    avatarRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: -56, paddingHorizontal: 20, justifyContent: 'space-between', zIndex: 2 },
    avatarWrapper: { borderWidth: 5, borderColor: '#fff', borderRadius: 64, overflow: 'hidden', backgroundColor: '#fff', },
    actionButtonWrapper: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end' },
    actionButton: { backgroundColor: '#fff', color: '#d169e5', borderWidth: 1, borderColor: '#d169e5', borderRadius: 24, paddingVertical: 7, paddingHorizontal: 22, fontWeight: 'bold', fontSize: 16, marginBottom: 8, elevation: 2, shadowColor: '#d169e5', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 2 },
    header: { alignItems: 'flex-start', paddingTop: 18, paddingBottom: 24, width: '100%', paddingHorizontal: 20 },
    displayName: { fontSize: 24, fontWeight: 'bold', marginTop: 10, marginBottom: 2, letterSpacing: 0.1 },
    subText: { fontSize: 16, marginBottom: 2, color: '#a0a0a0' },
    bio: { fontSize: 16, marginTop: 10, marginBottom: 10, color: '#666', fontStyle: 'italic', lineHeight: 22 },
    infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' },
    infoItem: { flexDirection: 'row', alignItems: 'center', marginRight: 28, marginBottom: 4, minWidth: 120 },
    infoText: { fontSize: 15 },
    divider: { height: 1, backgroundColor: '#e0e0e0', width: '100%', marginVertical: 14 },
    statsRow: { width: '100%', flex: 1, flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 2, justifyContent: 'space-between' },
    statItem: { flex: 1, alignItems: 'center', minWidth: 50, marginBottom: 12 },
    karmaLabel: { fontSize: 14, marginBottom: 2, textAlign: 'center', color: '#a0a0a0' },
    karmaAmount: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', letterSpacing: 0.2 },
});

export default ProfileScreen;
