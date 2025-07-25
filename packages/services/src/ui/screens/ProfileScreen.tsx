import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Image } from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import { FollowButton } from '../components';
import { useFollow } from '../hooks/useFollow';
import { Ionicons } from '@expo/vector-icons';

interface ProfileScreenProps extends BaseScreenProps {
    userId: string;
    username?: string;
}

const ProfileScreen: React.FC<ProfileScreenProps> = ({ userId, username, theme, goBack, navigate }) => {
    const { oxyServices, user: currentUser } = useOxy();
    const [profile, setProfile] = useState<any>(null);
    const [karmaTotal, setKarmaTotal] = useState<number | null>(null);
    const [postsCount, setPostsCount] = useState<number | null>(null);
    const [commentsCount, setCommentsCount] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [links, setLinks] = useState<Array<{
        url: string;
        title?: string;
        description?: string;
        image?: string;
        id: string;
    }>>([]);

    // Use the follow hook for real follower data
    const {
        followerCount,
        followingCount,
        isLoadingCounts,
        fetchUserCounts,
        setFollowerCount,
        setFollowingCount,
    } = useFollow(userId);

    const isDarkTheme = theme === 'dark';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const primaryColor = '#d169e5';

    // Check if current user is viewing their own profile
    const isOwnProfile = currentUser && currentUser.id === userId;

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

                // Extract links from profile data
                if (profileRes.linksMetadata && Array.isArray(profileRes.linksMetadata)) {
                    const linksWithIds = profileRes.linksMetadata.map((link: any, index: number) => ({
                        ...link,
                        id: link.id || `existing-${index}`
                    }));
                    setLinks(linksWithIds);
                } else if (Array.isArray(profileRes.links)) {
                    const simpleLinks = profileRes.links.map((l: any) => typeof l === 'string' ? l : l.link).filter(Boolean);
                    const linksWithMetadata = simpleLinks.map((url: string, index: number) => ({
                        url,
                        title: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        description: `Link to ${url}`,
                        image: undefined,
                        id: `existing-${index}`
                    }));
                    setLinks(linksWithMetadata);
                } else if (profileRes.website) {
                    setLinks([{
                        url: profileRes.website,
                        title: profileRes.website.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        description: `Link to ${profileRes.website}`,
                        image: undefined,
                        id: 'existing-0'
                    }]);
                } else {
                    setLinks([]);
                }

                // Set real follower counts from profile data if available
                if (profileRes._count) {
                    setFollowerCount?.(profileRes._count.followers || 0);
                    setFollowingCount?.(profileRes._count.following || 0);
                } else if (profileRes.stats) {
                    setFollowerCount?.(profileRes.stats.followers || 0);
                    setFollowingCount?.(profileRes.stats.following || 0);
                } else {
                    // Fallback: fetch counts separately
                    fetchUserCounts?.();
                }

                // Mock data for other stats (these would come from separate API endpoints)
                setPostsCount(Math.floor(Math.random() * 50));
                setCommentsCount(Math.floor(Math.random() * 100));
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
                    {/* Conditional Action Button */}
                    <View style={styles.actionButtonWrapper}>
                        {isOwnProfile ? (
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() => navigate?.('EditProfile')}
                            >
                                <Text style={styles.actionButtonText}>Edit Profile</Text>
                            </TouchableOpacity>
                        ) : (
                            <FollowButton
                                userId={userId}
                                theme={theme}
                                onFollowChange={(isFollowing) => {
                                    // The follow button will automatically update counts via Zustand
                                    console.log(`Follow status changed: ${isFollowing}`);
                                }}
                            />
                        )}
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

                    {/* Info Grid Row */}
                    <View style={styles.infoGrid}>
                        {profile?.createdAt && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="calendar-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Joined {new Date(profile.createdAt).toLocaleDateString()}</Text>
                            </View>
                        )}
                        {profile?.location && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="location-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]} numberOfLines={1}>{profile.location}</Text>
                            </View>
                        )}
                        {profile?.website && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="globe-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]} numberOfLines={1}>{profile.website}</Text>
                            </View>
                        )}
                        {profile?.company && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="business-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]} numberOfLines={1}>{profile.company}</Text>
                            </View>
                        )}
                        {profile?.jobTitle && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="briefcase-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]} numberOfLines={1}>{profile.jobTitle}</Text>
                            </View>
                        )}
                        {profile?.education && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="school-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]} numberOfLines={1}>{profile.education}</Text>
                            </View>
                        )}
                        {profile?.birthday && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="gift-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Born {new Date(profile.birthday).toLocaleDateString()}</Text>
                            </View>
                        )}
                        {links.length > 0 && (
                            <TouchableOpacity
                                style={styles.infoGridItem}
                                onPress={() => navigate?.('UserLinks', { userId, links })}
                            >
                                <Ionicons name="link-outline" size={16} color={isDarkTheme ? '#BBBBBB' : '#888888'} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]} numberOfLines={1}>
                                    {links[0].url}
                                </Text>
                                {links.length > 1 && (
                                    <Text style={[styles.linksMore, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>
                                        + {links.length - 1} more
                                    </Text>
                                )}
                            </TouchableOpacity>
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
                            {isLoadingCounts ? (
                                <ActivityIndicator size="small" color={textColor} />
                            ) : (
                                <Text style={[styles.karmaAmount, { color: textColor }]}>{followerCount !== null ? followerCount : '--'}</Text>
                            )}
                            <Text style={[styles.karmaLabel, { color: isDarkTheme ? '#BBBBBB' : '#888888' }]}>Followers</Text>
                        </View>
                        <View style={styles.statItem}>
                            {isLoadingCounts ? (
                                <ActivityIndicator size="small" color={textColor} />
                            ) : (
                                <Text style={[styles.karmaAmount, { color: textColor }]}>{followingCount !== null ? followingCount : '--'}</Text>
                            )}
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
    actionButton: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#d169e5',
        borderRadius: 24,
        paddingVertical: 7,
        paddingHorizontal: 22,
        marginBottom: 8,
        elevation: 2,
        shadowColor: '#d169e5',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2
    },
    actionButtonText: {
        color: '#d169e5',
        fontWeight: 'bold',
        fontSize: 16
    },
    header: { alignItems: 'flex-start', width: '100%', paddingHorizontal: 20 },
    displayName: { fontSize: 24, fontWeight: 'bold', marginTop: 10, marginBottom: 2, letterSpacing: 0.1 },
    subText: { fontSize: 16, marginBottom: 2, color: '#a0a0a0' },
    bio: { fontSize: 16, marginTop: 10, marginBottom: 10, color: '#666', lineHeight: 22 },
    infoGrid: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 10,
        flexWrap: 'wrap'
    },
    infoGridItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 24,
        marginBottom: 4
    },
    infoGridText: {
        fontSize: 15
    },
    divider: { height: 1, backgroundColor: '#e0e0e0', width: '100%', marginVertical: 14 },
    linksMore: {
        fontSize: 15,
        marginLeft: 4
    },
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
