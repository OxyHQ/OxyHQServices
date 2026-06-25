import type React from 'react';
import { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { Button } from '@oxyhq/bloom/button';
import { H2, Text } from '@oxyhq/bloom/typography';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import Avatar from '../components/Avatar';
import FollowButton from '../components/FollowButton';
import { useFollow } from '../hooks/useFollow';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';
import { getAccountDisplayName, logger } from '@oxyhq/core';
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

const AVATAR_SIZE = 96;
const BANNER_HEIGHT = 160;
const AVATAR_OVERLAP = -56;
const INFO_ICON_SIZE = 18;

const ProfileScreen: React.FC<ProfileScreenProps> = ({ userId, username, theme, goBack, navigate }) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices, user: currentUser } = useOxy();
    const [profile, setProfile] = useState<User | null>(null);
    const [reputationTotal, setReputationTotal] = useState<number | null>(null);
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

    const bloomTheme = useTheme();
    const { t, locale } = useI18n();

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

        // Load user profile, reputation total, and stats
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
            oxyServices.getReputationBalance(userId)
                .then((balance): { total: number | undefined } => ({ total: balance.total }))
                .catch((): { total: number | undefined } => ({ total: undefined })),
            oxyServices.getUserStats ?
                oxyServices.getUserStats(userId).catch(() => {
                    return { postCount: 0, commentCount: 0 };
                }) :
                Promise.resolve({ postCount: 0, commentCount: 0 })
        ])
            .then(([profileRes, reputationRes, statsRes]) => {
                if (!profileRes) {
                    setError('Profile data is not available');
                    setIsLoading(false);
                    return;
                }

                setProfile(profileRes);
                setReputationTotal(typeof reputationRes.total === 'number' ? reputationRes.total : null);

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
            <View style={styles.centerContainer} className="bg-bg">
                <ActivityIndicator size="large" color={bloomTheme.colors.primary} />
            </View>
        );
    }

    if (error) {
        return (
            <View style={styles.container} className="bg-bg">
                <View style={styles.errorHeader} className="px-screen-margin py-space-12 border-b border-border">
                    {goBack && (
                        <Button
                            variant="icon"
                            size="icon"
                            onPress={goBack}
                            accessibilityLabel={t('common.back') || 'Back'}
                            icon={<Ionicons name="arrow-back" size={22} color={bloomTheme.colors.text} />}
                        />
                    )}
                    <H2 style={styles.errorTitle} className="text-text">
                        {t('profile.errorTitle') || 'Profile Error'}
                    </H2>
                </View>
                <View style={styles.errorContent} className="px-space-32 gap-space-12">
                    <Ionicons name="alert-circle" size={48} color={bloomTheme.colors.error} />
                    <Text style={styles.errorText} className="text-text">{error}</Text>
                    <Text style={styles.errorSubtext} className="text-text-secondary">
                        {t('profile.errorSubtext') || "This could happen if the user doesn't exist or the profile service is unavailable."}
                    </Text>
                </View>
            </View>
        );
    }

    const displayName = profile ? getAccountDisplayName(profile, locale) : username || '';

    return (
        <View style={styles.container} className="bg-bg">
            <ScrollView style={styles.flex} contentContainerStyle={styles.scrollContainer}>
                {/* Banner Image */}
                <View style={styles.bannerContainer} className="bg-fill-brand/20">
                    <View style={styles.flex} className="bg-fill-brand" />
                </View>
                {/* Avatar overlapping banner */}
                <View style={styles.avatarRow} className="px-screen-margin">
                    <View style={styles.avatarWrapper} className="border-bg bg-bg rounded-radius-max">
                        <Avatar
                            uri={profile?.avatar ? oxyServices.getFileDownloadUrl(profile.avatar, 'thumb') : undefined}
                            name={displayName || username}
                            size={AVATAR_SIZE}
                        />
                    </View>
                    {/* Conditional Action Button */}
                    <View style={styles.actionButtonWrapper}>
                        {isOwnProfile ? (
                            <Button
                                variant="secondary"
                                size="small"
                                onPress={() => navigate?.('ManageAccount')}
                            >
                                {t('editProfile.title') || 'Edit Profile'}
                            </Button>
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
                <View style={styles.header} className="px-screen-margin">
                    <H2 style={styles.displayName} className="text-text">
                        {displayName}
                    </H2>
                    {profile?.username && (
                        <Text style={styles.subText} className="text-text-secondary">@{profile.username}</Text>
                    )}
                    {/* Bio */}
                    <Text style={styles.bio} className="text-text">{profile?.bio || (t('profile.noBio') || 'This user has no bio yet.')}</Text>
                </View>

                {/* Info Grid as a settings list group */}
                <SettingsListGroup>
                    {profile?.createdAt && (
                        <SettingsListItem
                            icon={<Ionicons name="calendar-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={t('profile.joinedOn', { date: new Date(profile.createdAt).toLocaleDateString() }) || `Joined ${new Date(profile.createdAt).toLocaleDateString()}`}
                            showChevron={false}
                        />
                    )}
                    {profile?.location && (
                        <SettingsListItem
                            icon={<Ionicons name="location-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={profile.location}
                            showChevron={false}
                        />
                    )}
                    {profile?.website && (
                        <SettingsListItem
                            icon={<Ionicons name="globe-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={profile.website}
                            showChevron={false}
                        />
                    )}
                    {profile && 'company' in profile && typeof profile.company === 'string' && profile.company && (
                        <SettingsListItem
                            icon={<Ionicons name="business-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={profile.company}
                            showChevron={false}
                        />
                    )}
                    {profile && 'jobTitle' in profile && typeof profile.jobTitle === 'string' && profile.jobTitle && (
                        <SettingsListItem
                            icon={<Ionicons name="briefcase-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={profile.jobTitle}
                            showChevron={false}
                        />
                    )}
                    {profile && 'education' in profile && typeof profile.education === 'string' && profile.education && (
                        <SettingsListItem
                            icon={<Ionicons name="school-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={profile.education}
                            showChevron={false}
                        />
                    )}
                    {profile && 'birthday' in profile && typeof profile.birthday === 'string' && profile.birthday && (
                        <SettingsListItem
                            icon={<Ionicons name="gift-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={t('profile.bornOn', { date: new Date(profile.birthday).toLocaleDateString() }) || `Born ${new Date(profile.birthday).toLocaleDateString()}`}
                            showChevron={false}
                        />
                    )}
                    {links.length > 0 && (
                        <SettingsListItem
                            icon={<Ionicons name="link-outline" size={INFO_ICON_SIZE} color={bloomTheme.colors.textSecondary} />}
                            title={links[0].url}
                            value={links.length > 1 ? (t('profile.more', { count: links.length - 1 }) || `+ ${links.length - 1} more`) : undefined}
                            onPress={() => navigate?.('UserLinks', { userId, links })}
                        />
                    )}
                </SettingsListGroup>

                {/* All Stats in one row */}
                <View style={styles.statsRow} className="px-screen-margin">
                    <View style={styles.statItem}>
                        <Text style={styles.statAmount} className="text-text-inverse">{reputationTotal !== null && reputationTotal !== undefined ? reputationTotal : '--'}</Text>
                        <Text style={styles.statLabel} className="text-text-secondary">{t('profile.reputation') || 'Reputation'}</Text>
                    </View>
                    <View style={styles.statItem}>
                        {isLoadingCounts ? (
                            <ActivityIndicator size="small" color={bloomTheme.colors.text} />
                        ) : (
                            <Text style={styles.statAmount} className="text-text">{followerCount !== null ? followerCount : '--'}</Text>
                        )}
                        <Text style={styles.statLabel} className="text-text-secondary">{t('profile.followers') || 'Followers'}</Text>
                    </View>
                    <View style={styles.statItem}>
                        {isLoadingCounts ? (
                            <ActivityIndicator size="small" color={bloomTheme.colors.text} />
                        ) : (
                            <Text style={styles.statAmount} className="text-text">{followingCount !== null ? followingCount : '--'}</Text>
                        )}
                        <Text style={styles.statLabel} className="text-text-secondary">{t('profile.following') || 'Following'}</Text>
                    </View>
                </View>
            </ScrollView>
        </View>
    );
};

// Layout-only styles: flex, dimensions, and the measured banner/avatar overlap
// that no token class can express. Colors, spacing, radius, and typography roles
// live on Bloom components + NativeWind token classes.
const styles = StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },
    centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    scrollContainer: { alignItems: 'stretch', paddingBottom: 40 },
    bannerContainer: { height: BANNER_HEIGHT, position: 'relative', overflow: 'hidden' },
    avatarRow: {
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginTop: AVATAR_OVERLAP,
        justifyContent: 'space-between',
        zIndex: 2,
    },
    avatarWrapper: { borderWidth: 5, overflow: 'hidden' },
    actionButtonWrapper: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', paddingBottom: 8 },
    header: { alignItems: 'flex-start', width: '100%', marginTop: 10 },
    displayName: { fontSize: 24, marginBottom: 2, letterSpacing: 0.1 },
    subText: { fontSize: 16, marginBottom: 2 },
    bio: { fontSize: 16, marginTop: 10, lineHeight: 22 },
    statsRow: {
        width: '100%',
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 14,
        justifyContent: 'space-between',
    },
    statItem: { flex: 1, alignItems: 'center', minWidth: 50, marginBottom: 12 },
    statLabel: { fontSize: 14, marginBottom: 2, textAlign: 'center' },
    statAmount: { fontSize: 24, fontWeight: 'bold', textAlign: 'center', letterSpacing: 0.2 },
    // Error state layout
    errorHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    errorTitle: { fontSize: 20 },
    errorContent: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    errorText: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
    errorSubtext: { fontSize: 14, textAlign: 'center' },
});

export default ProfileScreen;
