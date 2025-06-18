import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';

interface ProfileScreenProps extends BaseScreenProps {
    userId: string;
    username?: string;
}

const ProfileScreen: React.FC<ProfileScreenProps> = ({ userId, username, theme, goBack }) => {
    const { oxyServices, user: currentUser } = useOxy();
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
        console.log('ProfileScreen - userId:', userId);
        console.log('ProfileScreen - username:', username);
        
        if (!userId) {
            setError('No user ID provided');
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        // Load user profile and karma total
        Promise.all([
            oxyServices.getUserById(userId).catch(err => {
                console.error('getUserById error:', err);
                // If this is the current user and the API call fails, use current user data as fallback
                if (currentUser && currentUser.id === userId) {
                    console.log('API call failed, using current user as fallback:', currentUser);
                    return currentUser;
                }
                throw err;
            }),
            oxyServices.getUserKarmaTotal ? 
                oxyServices.getUserKarmaTotal(userId).catch(err => {
                    console.warn('getUserKarmaTotal error:', err);
                    return { total: undefined };
                }) : 
                Promise.resolve({ total: undefined })
        ])
            .then(([profileRes, karmaRes]) => {
                console.log('Profile loaded:', profileRes);
                setProfile(profileRes);
                setKarmaTotal(typeof karmaRes.total === 'number' ? karmaRes.total : null);

                // Mock data for other stats
                // In a real app, these would come from API endpoints
                setPostsCount(Math.floor(Math.random() * 50));
                setCommentsCount(Math.floor(Math.random() * 100));
                setFollowersCount(Math.floor(Math.random() * 200));
                setFollowingCount(Math.floor(Math.random() * 100));
            })
            .catch((err: any) => {
                console.error('Profile loading error:', err);
                // Provide user-friendly error messages based on the error type
                let errorMessage = 'Failed to load profile';
                
                if (err.status === 404 || err.message?.includes('not found') || err.message?.includes('Resource not found')) {
                    if (currentUser && currentUser.id === userId) {
                        errorMessage = 'Unable to load your profile from the server. This may be due to a temporary service issue.';
                    } else {
                        errorMessage = 'This user profile could not be found or may have been removed.';
                    }
                } else if (err.status === 403) {
                    errorMessage = 'You do not have permission to view this profile.';
                } else if (err.status === 500) {
                    errorMessage = 'Server error occurred while loading the profile. Please try again later.';
                } else if (err.message) {
                    errorMessage = err.message;
                }
                
                setError(errorMessage);
            })
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
            <View style={[styles.container, { backgroundColor }]}>
                <View style={styles.errorHeader}>
                    {goBack && (
                        <TouchableOpacity onPress={goBack} style={styles.backButton}>
                            <Ionicons name="arrow-back" size={24} color={textColor} />
                        </TouchableOpacity>
                    )}
                    <Text style={[styles.errorTitle, { color: textColor }]}>Profile Error</Text>
                </View>
                <View style={styles.errorContent}>
                    <Ionicons name="alert-circle" size={48} color="#D32F2F" style={styles.errorIcon} />
                    <Text style={[styles.errorText, { color: '#D32F2F' }]}>{error}</Text>
                    <Text style={[styles.errorSubtext, { color: textColor }]}>
                        This could happen if the user doesn't exist or the profile service is unavailable.
                    </Text>
                </View>
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
    // Error handling styles
    errorHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#E0E0E0',
    },
    backButton: {
        padding: 8,
        marginRight: 16,
    },
    errorTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    errorContent: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
    },
    errorIcon: {
        marginBottom: 16,
    },
    errorText: {
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 8,
    },
    errorSubtext: {
        fontSize: 14,
        textAlign: 'center',
        opacity: 0.7,
    },
});

export default ProfileScreen;
