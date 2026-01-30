import type React from 'react';
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Image } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeColors, type ThemeColors } from '../styles';
import Avatar from '../components/Avatar';
import { FollowButton } from '../components';
import { useFollow } from '../hooks/useFollow';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';
import { logger } from '@oxyhq/core';
import type { User } from '@oxyhq/core';
import { extractErrorMessage } from '../utils/errorHandlers';

interface ProfileScreenProps extends BaseScreenProps {
    userId: string;
    username?: string;
}

interface LinkMetadata {
    id?: string;
    url: string;
    title?: string;
    description?: string;
    image?: string;
}

type ProfileLink = string | { link: string } | LinkMetadata;

const ProfileScreen: React.FC<ProfileScreenProps> = ({ userId, username, theme, goBack, navigate }) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices, user: currentUser } = useOxy();
    const [profile, setProfile] = useState<User | null>(null);
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
    } = useFollow(userId);

    const colors = useThemeColors((theme as 'light' | 'dark') ?? 'light');
    const styles = createStyles(colors);
    const { t } = useI18n();

    // Check if current user is viewing their own profile
    // Normalize IDs by trimming whitespace to handle format mismatches
    const normalizeId = (id: string | undefined | null): string => {
        if (!id) return '';
        return String(id).trim();
    };

    const currentUserId = normalizeId(currentUser?.id);
    const targetUserId = normalizeId(userId);
    const isOwnProfile = currentUserId && targetUserId && currentUserId === targetUserId;

    useEffect(() => {
        if (!userId) {
            setError('No user ID provided');
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);

        // Load user profile, karma total, and stats
        Promise.all([
            oxyServices.getUserById(userId).catch((err: unknown) => {
                // If this is the current user and the API call fails, use current user data as fallback
                const normalizedCurrentId = normalizeId(currentUser?.id);
                const normalizedTargetId = normalizeId(userId);
                if (normalizedCurrentId && normalizedTargetId && normalizedCurrentId === normalizedTargetId) {
                    return currentUser;
                }
                throw err;
            }),
            oxyServices.getUserKarmaTotal ?
                oxyServices.getUserKarmaTotal(userId).catch(() => {
                    return { total: undefined };
                }) :
                Promise.resolve({ total: undefined }),
            oxyServices.getUserStats ?
                oxyServices.getUserStats(userId).catch(() => {
                    return { postCount: 0, commentCount: 0 };
                }) :
                Promise.resolve({ postCount: 0, commentCount: 0 })
        ])
            .then(([profileRes, karmaRes, statsRes]) => {
                if (!profileRes) {
                    setError('Profile data is not available');
                    setIsLoading(false);
                    return;
                }

                setProfile(profileRes);
                setKarmaTotal(typeof karmaRes.total === 'number' ? karmaRes.total : null);

                // Extract links from profile data
                if (profileRes.linksMetadata && Array.isArray(profileRes.linksMetadata)) {
                    const linksWithIds = profileRes.linksMetadata.map((link: LinkMetadata, index: number) => ({
                        ...link,
                        id: link.id || `existing-${index}`
                    }));
                    setLinks(linksWithIds);
                } else if (Array.isArray(profileRes.links)) {
                    const simpleLinks = profileRes.links.map((l: ProfileLink) => typeof l === 'string' ? l : (typeof l === 'object' && 'link' in l ? l.link : '')).filter(Boolean);
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

                // Follower/following counts are managed by the `useFollow` hook.

                // User stats from API
                setPostsCount(statsRes?.postCount ?? 0);
                setCommentsCount(statsRes?.commentCount ?? 0);
            })
            .catch((err: unknown) => {
                logger.error('Profile loading error', err instanceof Error ? err : new Error(String(err)), { component: 'ProfileScreen' });
                // Provide user-friendly error messages based on the error type
                let errorMessage = 'Failed to load profile';

                // Type guard for error with status property
                const errorWithStatus = err && typeof err === 'object' && 'status' in err ? err as { status?: number; message?: string } : null;
                const errorMessageText = extractErrorMessage(err, '');

                if (errorWithStatus?.status === 404 || errorMessageText.includes('not found') || errorMessageText.includes('Resource not found')) {
                    const normalizedCurrentId = normalizeId(currentUser?.id);
                    const normalizedTargetId = normalizeId(userId);
                    if (normalizedCurrentId && normalizedTargetId && normalizedCurrentId === normalizedTargetId) {
                        errorMessage = 'Unable to load your profile from the server. This may be due to a temporary service issue.';
                    } else {
                        errorMessage = 'This user profile could not be found or may have been removed.';
                    }
                } else if (errorWithStatus?.status === 403) {
                    errorMessage = 'You do not have permission to view this profile.';
                } else if (errorWithStatus?.status === 500) {
                    errorMessage = 'Server error occurred while loading the profile. Please try again later.';
                } else if (errorMessageText) {
                    errorMessage = errorMessageText;
                }

                setError(errorMessage);
            })
            .finally(() => setIsLoading(false));
    }, [userId]);

    if (isLoading) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={colors.primary} />
            </View>
        );
    }

    if (error) {
        return (
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.errorHeader}>
                    {goBack && (
                        <TouchableOpacity onPress={goBack} style={styles.backButton}>
                            <Ionicons name="arrow-back" size={24} color={colors.text} />
                        </TouchableOpacity>
                    )}
                    <Text style={[styles.errorTitle, { color: colors.text }]}>Profile Error</Text>
                </View>
                <View style={styles.errorContent}>
                    <Ionicons name="alert-circle" size={48} color={colors.error} style={styles.errorIcon} />
                    <Text style={[styles.errorText, { color: colors.error }]}>{error}</Text>
                    <Text style={[styles.errorSubtext, { color: colors.secondaryText }]}>
                        This could happen if the user doesn't exist or the profile service is unavailable.
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.scrollContainer}>
                {/* Banner Image */}
                <View style={styles.bannerContainer}>
                    <View style={styles.bannerImage} />
                </View>
                {/* Avatar overlapping banner */}
                <View style={styles.avatarRow}>
                    <View style={styles.avatarWrapper}>
                        <Avatar
                            uri={profile?.avatar ? oxyServices.getFileDownloadUrl(profile.avatar as string, 'thumb') : undefined}
                            name={profile?.username || username}
                            size={96}

                        />
                    </View>
                    {/* Conditional Action Button */}
                    <View style={styles.actionButtonWrapper}>
                        {isOwnProfile ? (
                            <TouchableOpacity
                                style={styles.actionButton}
                                onPress={() => navigate?.('AccountSettings')}
                            >
                                <Text style={styles.actionButtonText}>{t('editProfile.title') || 'Edit Profile'}</Text>
                            </TouchableOpacity>
                        ) : (
                            <FollowButton
                                userId={userId}

                                onFollowChange={(isFollowing) => {
                                    // The follow button will automatically update counts via Zustand
                                    if (__DEV__) {
                                        logger.debug(`Follow status changed: ${isFollowing}`, { component: 'ProfileScreen' });
                                    }
                                }}
                            />
                        )}
                    </View>
                </View>
                {/* Profile Info */}
                <View style={styles.header}>
                    <Text style={[styles.displayName, { color: colors.text }]}>
                        {(profile && 'displayName' in profile && typeof profile.displayName === 'string' ? profile.displayName : null) || profile?.username || username || profile?.id || ''}
                    </Text>
                    {profile?.username && (
                        <Text style={[styles.subText, { color: colors.secondaryText }]}>@{profile.username}</Text>
                    )}
                    {/* Bio placeholder */}
                    <Text style={[styles.bio, { color: colors.text }]}>{profile?.bio || (t('profile.noBio') || 'This user has no bio yet.')}</Text>

                    {/* Info Grid Row */}
                    <View style={styles.infoGrid}>
                        {profile?.createdAt && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="calendar-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]}>
                                    {t('profile.joinedOn', { date: new Date(profile.createdAt).toLocaleDateString() }) || `Joined ${new Date(profile.createdAt).toLocaleDateString()}`}
                                </Text>
                            </View>
                        )}
                        {profile?.location && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="location-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]} numberOfLines={1}>{profile.location}</Text>
                            </View>
                        )}
                        {profile?.website && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="globe-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]} numberOfLines={1}>{profile.website}</Text>
                            </View>
                        )}
                        {profile && 'company' in profile && typeof profile.company === 'string' && profile.company && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="business-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]} numberOfLines={1}>{profile.company}</Text>
                            </View>
                        )}
                        {profile && 'jobTitle' in profile && typeof profile.jobTitle === 'string' && profile.jobTitle && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="briefcase-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]} numberOfLines={1}>{profile.jobTitle}</Text>
                            </View>
                        )}
                        {profile && 'education' in profile && typeof profile.education === 'string' && profile.education && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="school-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]} numberOfLines={1}>{profile.education}</Text>
                            </View>
                        )}
                        {profile && 'birthday' in profile && typeof profile.birthday === 'string' && profile.birthday && (
                            <View style={styles.infoGridItem}>
                                <Ionicons name="gift-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]}>
                                    {t('profile.bornOn', { date: new Date(profile.birthday).toLocaleDateString() }) || `Born ${new Date(profile.birthday).toLocaleDateString()}`}
                                </Text>
                            </View>
                        )}
                        {links.length > 0 && (
                            <TouchableOpacity
                                style={styles.infoGridItem}
                                onPress={() => navigate?.('UserLinks', { userId, links })}
                            >
                                <Ionicons name="link-outline" size={16} color={colors.secondaryText} style={{ marginRight: 6 }} />
                                <Text style={[styles.infoGridText, { color: colors.secondaryText }]} numberOfLines={1}>
                                    {links[0].url}
                                </Text>
                                {links.length > 1 && (
                                    <Text style={[styles.linksMore, { color: colors.secondaryText }]}>
                                        {t('profile.more', { count: links.length - 1 }) || `+ ${links.length - 1} more`}
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
                            <Text style={[styles.karmaAmount, { color: colors.primary }]}>{karmaTotal !== null && karmaTotal !== undefined ? karmaTotal : '--'}</Text>
                            <Text style={[styles.karmaLabel, { color: colors.secondaryText }]}>{t('profile.karma') || 'Karma'}</Text>
                        </View>
                        <View style={styles.statItem}>
                            {isLoadingCounts ? (
                                <ActivityIndicator size="small" color={colors.text} />
                            ) : (
                                <Text style={[styles.karmaAmount, { color: colors.text }]}>{followerCount !== null ? followerCount : '--'}</Text>
                            )}
                            <Text style={[styles.karmaLabel, { color: colors.secondaryText }]}>{t('profile.followers') || 'Followers'}</Text>
                        </View>
                        <View style={styles.statItem}>
                            {isLoadingCounts ? (
                                <ActivityIndicator size="small" color={colors.text} />
                            ) : (
                                <Text style={[styles.karmaAmount, { color: colors.text }]}>{followingCount !== null ? followingCount : '--'}</Text>
                            )}
                            <Text style={[styles.karmaLabel, { color: colors.secondaryText }]}>{t('profile.following') || 'Following'}</Text>
                        </View>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
};

const createStyles = (colors: ThemeColors) => StyleSheet.create({
    container: { flex: 1 },
    scrollContainer: { alignItems: 'stretch', paddingBottom: 40 },
    bannerContainer: { height: 160, backgroundColor: colors.primary + '20', position: 'relative', overflow: 'hidden' },
    bannerImage: { flex: 1, backgroundColor: colors.primary }, // Placeholder, replace with Image if available
    avatarRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: -56, paddingHorizontal: 20, justifyContent: 'space-between', zIndex: 2 },
    avatarWrapper: { borderWidth: 5, borderColor: colors.background, borderRadius: 64, overflow: 'hidden', backgroundColor: colors.background },
    actionButtonWrapper: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end' },
    actionButton: {
        backgroundColor: colors.background,
        borderWidth: 1,
        borderColor: colors.primary,
        borderRadius: 24,
        paddingVertical: 7,
        paddingHorizontal: 22,
        marginBottom: 8,
        elevation: 2,
        shadowColor: colors.primary,
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2
    },
    actionButtonText: {
        color: colors.primary,
        fontWeight: 'bold',
        fontSize: 16
    },
    header: { alignItems: 'flex-start', width: '100%', paddingHorizontal: 20 },
    displayName: { fontSize: 24, fontWeight: 'bold', marginTop: 10, marginBottom: 2, letterSpacing: 0.1 },
    subText: { fontSize: 16, marginBottom: 2, color: colors.secondaryText },
    bio: { fontSize: 16, marginTop: 10, marginBottom: 10, color: colors.text, lineHeight: 22 },
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
        fontSize: 15,
        color: colors.text
    },
    divider: { height: 1, backgroundColor: colors.border, width: '100%', marginVertical: 14 },
    linksMore: {
        fontSize: 15,
        marginLeft: 4
    },
    statsRow: { width: '100%', flex: 1, flexDirection: 'row', alignItems: 'center', marginTop: 6, marginBottom: 2, justifyContent: 'space-between' },
    statItem: { flex: 1, alignItems: 'center', minWidth: 50, marginBottom: 12 },
    karmaLabel: { fontSize: 14, marginBottom: 2, textAlign: 'center', color: colors.secondaryText },
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
