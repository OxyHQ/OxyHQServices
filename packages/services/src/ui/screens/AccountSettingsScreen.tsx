import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Animated,
    Platform,
    Image,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import * as Prompt from '@oxyhq/bloom/prompt';
import { usePromptControl } from '@oxyhq/bloom/prompt';
import { useAuthStore } from '../stores/authStore';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme } from '../utils/themeUtils';
import type { ProfileFieldType } from './EditProfileFieldScreen';
import { getDisplayName } from '../utils/userUtils';
import { useOxy } from '../context/OxyContext';
import { useCurrentUser } from '../hooks/queries/useAccountQueries';
import { useUploadAvatar } from '../hooks/mutations/useAccountMutations';
import {
    SECTION_GAP_LARGE,
    COMPONENT_GAP,
    HEADER_PADDING_TOP_SETTINGS,
    createScreenContentStyle,
} from '../constants/spacing';



const AccountSettingsScreen: React.FC<BaseScreenProps & { initialField?: string; initialSection?: string }> = ({
    onClose,
    theme,
    goBack,
    navigate,
    initialField,
    initialSection,
    scrollTo,
}) => {
    // Use useOxy() hook for OxyContext values
    const {
        oxyServices,
        isAuthenticated,
    } = useOxy();
    const { t } = useI18n();

    // Use TanStack Query for user data
    const { data: user, isLoading: userLoading } = useCurrentUser({ enabled: isAuthenticated });
    const uploadAvatarMutation = useUploadAvatar();

    // Prompt controls
    const removeAvatarPrompt = usePromptControl();

    // Fallback to store for backward compatibility
    const userFromStore = useAuthStore((state) => state.user);
    const finalUser = user || userFromStore;
    const isUpdatingAvatar = uploadAvatarMutation.isPending;
    const [optimisticAvatarId, setOptimisticAvatarId] = useState<string | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const avatarSectionRef = useRef<View>(null);

    // Section refs for navigation
    const profilePictureSectionRef = useRef<View>(null);
    const basicInfoSectionRef = useRef<View>(null);
    const aboutSectionRef = useRef<View>(null);
    const quickActionsSectionRef = useRef<View>(null);
    const securitySectionRef = useRef<View>(null);

    // Section Y positions for scrolling
    const [profilePictureSectionY, setProfilePictureSectionY] = useState<number | null>(null);
    const [basicInfoSectionY, setBasicInfoSectionY] = useState<number | null>(null);
    const [aboutSectionY, setAboutSectionY] = useState<number | null>(null);
    const [quickActionsSectionY, setQuickActionsSectionY] = useState<number | null>(null);
    const [securitySectionY, setSecuritySectionY] = useState<number | null>(null);



    // Form state
    const [displayName, setDisplayName] = useState('');
    const [lastName, setLastName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [bio, setBio] = useState('');
    const [location, setLocation] = useState('');
    const [links, setLinks] = useState<string[]>([]);
    const [avatarFileId, setAvatarFileId] = useState('');

    // Navigation helper for editing fields
    const navigateToEditField = useCallback((fieldType: ProfileFieldType) => {
        navigate?.('EditProfileField', { fieldType });
    }, [navigate]);

    // Location and links state (for display only - modals handle editing)
    const [locations, setLocations] = useState<Array<{
        id: string;
        name: string;
        label?: string;
        coordinates?: { lat: number; lon: number };
    }>>([]);
    const [linksMetadata, setLinksMetadata] = useState<Array<{
        url: string;
        title?: string;
        description?: string;
        image?: string;
        id: string;
    }>>([]);


    // Get theme colors
    const bloomTheme = useTheme();
    const colorScheme = useColorScheme();

    // Extract colors for convenience
    const colors = Colors[normalizeColorScheme(colorScheme, theme || 'light')];


    // Track initialization to prevent unnecessary resets
    const isInitializedRef = useRef(false);
    const previousUserIdRef = useRef<string | null>(null);
    const previousAvatarRef = useRef<string | null>(null);

    // Load user data - only reset fields when user actually changes (not just avatar)
    useEffect(() => {
        if (finalUser) {
            const currentUserId = finalUser.id;
            const currentAvatar = finalUser.avatar ?? '';
            const isNewUser = previousUserIdRef.current !== currentUserId;
            const isAvatarOnlyUpdate = !isNewUser && previousUserIdRef.current === currentUserId &&
                previousAvatarRef.current !== currentAvatar &&
                previousAvatarRef.current !== null;
            const shouldInitialize = !isInitializedRef.current || isNewUser;

            // Only reset all fields if it's a new user or first load
            // Skip reset if it's just an avatar update
            if (shouldInitialize && !isAvatarOnlyUpdate) {
                const userDisplayName = typeof finalUser.name === 'string'
                    ? finalUser.name
                    : finalUser.name?.first || finalUser.name?.full || '';
                const userLastName = typeof finalUser.name === 'object' ? finalUser.name?.last || '' : '';
                setDisplayName(userDisplayName);
                setLastName(userLastName);
                setUsername(finalUser.username || '');
                setEmail(finalUser.email || '');
                setBio(finalUser.bio || '');
                setLocation(finalUser.location || '');

                // Handle locations - convert single location to array format
                if (finalUser.locations && Array.isArray(finalUser.locations)) {
                    setLocations(finalUser.locations.map((loc: any, index: number) => ({
                        id: loc.id || `existing-${index}`,
                        name: loc.name,
                        label: loc.label,
                        coordinates: loc.coordinates
                    })));
                } else if (finalUser.location) {
                    // Convert single location string to array format
                    setLocations([{
                        id: 'existing-0',
                        name: finalUser.location,
                        label: 'Location'
                    }]);
                } else {
                    setLocations([]);
                }

                // Handle links - simple and direct like other fields
                if (finalUser.linksMetadata && Array.isArray(finalUser.linksMetadata)) {
                    const urls = finalUser.linksMetadata.map((l: any) => l.url);
                    setLinks(urls);
                    const metadataWithIds = finalUser.linksMetadata.map((link: any, index: number) => ({
                        ...link,
                        id: link.id || `existing-${index}`
                    }));
                    setLinksMetadata(metadataWithIds);
                } else if (Array.isArray(finalUser.links)) {
                    const simpleLinks = finalUser.links.map((l: any) => typeof l === 'string' ? l : l.link).filter(Boolean);
                    setLinks(simpleLinks);
                    const linksWithMetadata = simpleLinks.map((url: string, index: number) => ({
                        url,
                        title: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        description: `Link to ${url}`,
                        image: undefined,
                        id: `existing-${index}`
                    }));
                    setLinksMetadata(linksWithMetadata);
                } else if (finalUser.website) {
                    setLinks([finalUser.website]);
                    setLinksMetadata([{
                        url: finalUser.website,
                        title: finalUser.website.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        description: `Link to ${finalUser.website}`,
                        image: undefined,
                        id: 'existing-0'
                    }]);
                } else {
                    setLinks([]);
                    setLinksMetadata([]);
                }
                isInitializedRef.current = true;
            }

            // Update avatar only if it changed and we're not in optimistic/updating state
            // This allows the server response to update the avatar without resetting other fields
            // But don't override if we have a pending optimistic update
            if (currentAvatar !== avatarFileId && !isUpdatingAvatar && !optimisticAvatarId) {
                setAvatarFileId(currentAvatar);
            }

            // If we just finished updating and the server avatar matches our optimistic one, clear optimistic state
            // Also clear if the server avatar matches our current avatarFileId (update completed)
            if (isUpdatingAvatar === false && optimisticAvatarId) {
                if (currentAvatar === optimisticAvatarId || currentAvatar === avatarFileId) {
                    setOptimisticAvatarId(null);
                }
            }

            previousUserIdRef.current = currentUserId;
            previousAvatarRef.current = currentAvatar;
        }
    }, [finalUser, avatarFileId, isUpdatingAvatar, optimisticAvatarId]);

    // Set initial editing field if provided via props (e.g., from navigation)
    // Handle initialSection prop to scroll to specific section
    const hasScrolledToSectionRef = useRef(false);
    const previousInitialSectionRef = useRef<string | undefined>(undefined);
    const SCROLL_OFFSET = 100; // Offset to show section near top of viewport

    // Map section names to their Y positions
    const sectionYPositions = useMemo(() => ({
        profilePicture: profilePictureSectionY,
        basicInfo: basicInfoSectionY,
        about: aboutSectionY,
        quickActions: quickActionsSectionY,
        security: securitySectionY,
    }), [profilePictureSectionY, basicInfoSectionY, aboutSectionY, quickActionsSectionY, securitySectionY]);

    useEffect(() => {
        // If initialSection changed, reset the flag
        if (previousInitialSectionRef.current !== initialSection) {
            hasScrolledToSectionRef.current = false;
            previousInitialSectionRef.current = initialSection;
        }

        // Scroll to the specified section if initialSection is provided and we haven't scrolled yet
        if (initialSection && !hasScrolledToSectionRef.current) {
            const sectionY = sectionYPositions[initialSection as keyof typeof sectionYPositions];

            if (sectionY !== null && sectionY !== undefined && scrollTo) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        scrollTo(Math.max(0, sectionY - SCROLL_OFFSET), true);
                        hasScrolledToSectionRef.current = true;
                    });
                });
            }
        }
    }, [initialSection, sectionYPositions]);

    const handleAvatarRemoveConfirmed = useCallback(() => {
        setAvatarFileId('');
        toast.success(t('editProfile.toasts.avatarRemoved') || 'Avatar removed');
    }, [t]);

    const handleAvatarRemove = useCallback(() => {
        removeAvatarPrompt.open();
    }, [removeAvatarPrompt]);

    const { openAvatarPicker } = useOxy();

    // Handlers to navigate to edit screens
    const handleOpenDisplayNameModal = useCallback(() => navigateToEditField('displayName'), [navigateToEditField]);
    const handleOpenUsernameModal = useCallback(() => navigateToEditField('username'), [navigateToEditField]);
    const handleOpenEmailModal = useCallback(() => navigateToEditField('email'), [navigateToEditField]);
    const handleOpenBioModal = useCallback(() => navigateToEditField('bio'), [navigateToEditField]);
    const handleOpenLocationModal = useCallback(() => navigateToEditField('locations'), [navigateToEditField]);
    const handleOpenLinksModal = useCallback(() => navigateToEditField('links'), [navigateToEditField]);

    // Handle initialField prop - navigate to appropriate edit screen
    useEffect(() => {
        if (initialField) {
            // Special handling for avatar - open avatar picker directly
            if (initialField === 'avatar') {
                setTimeout(() => {
                    openAvatarPicker();
                }, 300);
            } else {
                // Navigate to edit screen
                setTimeout(() => {
                    const fieldTypeMap: Record<string, ProfileFieldType> = {
                        displayName: 'displayName',
                        username: 'username',
                        email: 'email',
                        bio: 'bio',
                        location: 'locations',
                        locations: 'locations',
                        links: 'links',
                    };
                    const fieldType = fieldTypeMap[initialField];
                    if (fieldType) {
                        navigateToEditField(fieldType);
                    }
                }, 300);
            }
        }
    }, [initialField, openAvatarPicker, navigateToEditField]);




    // Memoize display name for avatar
    const displayNameForAvatar = useMemo(() => getDisplayName(finalUser), [finalUser]);




    if (userLoading || !isAuthenticated) {
        return (
            <View style={[styles.container, { justifyContent: 'center', backgroundColor: bloomTheme.colors.background }]}>
                <ActivityIndicator size="large" color={bloomTheme.colors.primary} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <ScrollView
                ref={scrollViewRef}
                style={styles.content}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Title and Subtitle Header */}
                <View style={[styles.headerContainer, styles.headerSection]}>
                            <Text style={[styles.modernTitle, { marginBottom: 0, marginTop: 0 }]} className="text-foreground">
                                {t('accountOverview.items.editProfile.title') || t('editProfile.title') || 'Edit Profile'}
                            </Text>
                            <Text style={[styles.modernSubtitle, { marginBottom: 0, marginTop: 0 }]} className="text-muted-foreground">
                                {t('accountOverview.items.editProfile.subtitle') || t('editProfile.subtitle') || 'Manage your profile and preferences'}
                            </Text>
                        </View>

                        {/* Profile Picture Section */}
                        <View
                            ref={(ref) => {
                                avatarSectionRef.current = ref;
                                profilePictureSectionRef.current = ref;
                            }}
                            style={styles.section}
                            onLayout={(event) => {
                                const { y } = event.nativeEvent.layout;
                                setProfilePictureSectionY(y);
                            }}
                        >
                            <Text style={styles.sectionTitle} className="text-muted-foreground">
                                {t('editProfile.sections.profilePicture') || 'PROFILE PICTURE'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <SettingsListGroup>
                                    <SettingsListItem
                                        icon={(optimisticAvatarId || avatarFileId) ? (
                                            isUpdatingAvatar ? (
                                                <Animated.View style={{ position: 'relative', width: 36, height: 36 }}>
                                                    <Animated.Image
                                                        source={{ uri: oxyServices.getFileDownloadUrl(optimisticAvatarId || avatarFileId, 'thumb') }}
                                                        style={{
                                                            width: 36,
                                                            height: 36,
                                                            borderRadius: 18,
                                                            opacity: 0.6
                                                        }}
                                                    />
                                                    <View style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        left: 0,
                                                        right: 0,
                                                        bottom: 0,
                                                        justifyContent: 'center',
                                                        alignItems: 'center',
                                                        backgroundColor: colorScheme === 'dark' ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.7)',
                                                        borderRadius: 18,
                                                    }}>
                                                        <ActivityIndicator size="small" color={colors.tint} />
                                                    </View>
                                                </Animated.View>
                                            ) : (
                                                <Image
                                                    source={{ uri: oxyServices.getFileDownloadUrl(optimisticAvatarId || avatarFileId, 'thumb') }}
                                                    style={{ width: 36, height: 36, borderRadius: 18 }}
                                                />
                                            )
                                        ) : (
                                            <MaterialCommunityIcons name="account-outline" size={20} color={colors.sidebarIconPersonalInfo} />
                                        )}
                                        title="Profile Photo"
                                        description={isUpdatingAvatar
                                            ? 'Updating profile picture...'
                                            : (avatarFileId ? 'Tap to change your profile picture' : 'Tap to add a profile picture')}
                                        onPress={isUpdatingAvatar ? undefined : openAvatarPicker}
                                        disabled={isUpdatingAvatar}
                                    />
                                    {avatarFileId && !isUpdatingAvatar ? (
                                        <SettingsListItem
                                            icon={<MaterialCommunityIcons name="delete-outline" size={20} color={colors.sidebarIconSharing} />}
                                            title="Remove Photo"
                                            description="Delete current profile picture"
                                            onPress={handleAvatarRemove}
                                        />
                                    ) : null}
                                </SettingsListGroup>
                            </View>
                        </View>

                        {/* Basic Information */}
                        <View
                            ref={basicInfoSectionRef}
                            style={styles.section}
                            onLayout={(event) => {
                                const { y } = event.nativeEvent.layout;
                                setBasicInfoSectionY(y);
                            }}
                        >
                            <Text style={styles.sectionTitle} className="text-muted-foreground">
                                {t('editProfile.sections.basicInfo') || 'BASIC INFORMATION'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <SettingsListGroup>
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="account-outline" size={20} color={colors.sidebarIconPersonalInfo} />}
                                        title={t('editProfile.items.displayName.title') || 'Display Name'}
                                        description={[displayName, lastName].filter(Boolean).join(' ') || (t('editProfile.items.displayName.add') || 'Add your display name')}
                                        onPress={handleOpenDisplayNameModal}
                                    />
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="at" size={20} color={colors.sidebarIconData} />}
                                        title={t('editProfile.items.username.title') || 'Username'}
                                        description={username || (t('editProfile.items.username.choose') || 'Choose a username')}
                                        onPress={handleOpenUsernameModal}
                                    />
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="email-outline" size={20} color={colors.sidebarIconSecurity} />}
                                        title={t('editProfile.items.email.title') || 'Email'}
                                        description={email || (t('editProfile.items.email.add') || 'Add your email address')}
                                        onPress={handleOpenEmailModal}
                                    />
                                </SettingsListGroup>
                            </View>
                        </View>

                        {/* About You */}
                        <View
                            ref={aboutSectionRef}
                            style={styles.section}
                            onLayout={(event) => {
                                const { y } = event.nativeEvent.layout;
                                setAboutSectionY(y);
                            }}
                        >
                            <Text style={styles.sectionTitle} className="text-muted-foreground">
                                {t('editProfile.sections.about') || 'ABOUT YOU'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <SettingsListGroup>
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="text-box-outline" size={20} color={colors.sidebarIconPersonalInfo} />}
                                        title={t('editProfile.items.bio.title') || 'Bio'}
                                        description={bio || (t('editProfile.items.bio.placeholder') || 'Tell people about yourself')}
                                        onPress={handleOpenBioModal}
                                    />
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="map-marker-outline" size={20} color={colors.sidebarIconSharing} />}
                                        title={t('editProfile.items.locations.title') || 'Locations'}
                                        description={locations.length > 0
                                            ? (locations.length === 1
                                                ? (t('editProfile.items.locations.count', { count: locations.length }) || `${locations.length} location added`)
                                                : (t('editProfile.items.locations.count_plural', { count: locations.length }) || `${locations.length} locations added`))
                                            : (t('editProfile.items.locations.add') || 'Add your locations')}
                                        onPress={handleOpenLocationModal}
                                    />
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="link-variant" size={20} color={colors.sidebarIconSharing} />}
                                        title={t('editProfile.items.links.title') || 'Links'}
                                        description={linksMetadata.length > 0
                                            ? (linksMetadata.length === 1
                                                ? (t('editProfile.items.links.count', { count: linksMetadata.length }) || `${linksMetadata.length} link added`)
                                                : (t('editProfile.items.links.count_plural', { count: linksMetadata.length }) || `${linksMetadata.length} links added`))
                                            : (t('editProfile.items.links.add') || 'Add your links')}
                                        onPress={handleOpenLinksModal}
                                    />
                                </SettingsListGroup>
                            </View>
                        </View>

                        {/* Quick Actions */}
                        <View
                            ref={quickActionsSectionRef}
                            style={styles.section}
                            onLayout={(event) => {
                                const { y } = event.nativeEvent.layout;
                                setQuickActionsSectionY(y);
                            }}
                        >
                            <Text style={styles.sectionTitle} className="text-muted-foreground">
                                {t('editProfile.sections.quickActions') || 'QUICK ACTIONS'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <SettingsListGroup>
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="eye" size={20} color={colors.sidebarIconHome} />}
                                        title={t('editProfile.items.previewProfile.title') || 'Preview Profile'}
                                        description={t('editProfile.items.previewProfile.subtitle') || 'See how your profile looks to others'}
                                        onPress={() => navigate?.('Profile', { userId: finalUser?.id })}
                                    />
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="shield-check" size={20} color={colors.sidebarIconSecurity} />}
                                        title={t('editProfile.items.privacySettings.title') || 'Privacy Settings'}
                                        description={t('editProfile.items.privacySettings.subtitle') || 'Control who can see your profile'}
                                        onPress={() => navigate?.('PrivacySettings')}
                                    />
                                    <SettingsListItem
                                        icon={<MaterialCommunityIcons name="check-circle" size={20} color={colors.sidebarIconPersonalInfo} />}
                                        title={t('editProfile.items.verifyAccount.title') || 'Verify Account'}
                                        description={t('editProfile.items.verifyAccount.subtitle') || 'Get a verified badge'}
                                        onPress={() => navigate?.('AccountVerification')}
                                    />
                                </SettingsListGroup>
                            </View>
                        </View>

                        {/* Security */}
                        <View
                            ref={securitySectionRef}
                            style={styles.section}
                            onLayout={(event) => {
                                const { y } = event.nativeEvent.layout;
                                setSecuritySectionY(y);
                            }}
                        >
                            <Text style={styles.sectionTitle} className="text-muted-foreground">
                                {t('editProfile.sections.security') || 'SECURITY'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                            </View>
                        </View>
            </ScrollView>
            <Prompt.Basic
                control={removeAvatarPrompt}
                title={t('editProfile.confirms.removeAvatarTitle') || 'Remove Avatar'}
                description={t('editProfile.confirms.removeAvatar') || 'Remove your profile picture?'}
                onConfirm={handleAvatarRemoveConfirmed}
                confirmButtonCta={t('common.remove') || 'Remove'}
                confirmButtonColor='negative'
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexShrink: 1,
        width: '100%',
    },
    content: {
        flexShrink: 1,
    },
    scrollContent: createScreenContentStyle(HEADER_PADDING_TOP_SETTINGS),
    headerContainer: {
        width: '100%',
        maxWidth: 420,
        alignSelf: 'center',
        marginBottom: SECTION_GAP_LARGE,
    },
    headerSection: {
        alignItems: 'flex-start',
        width: '100%',
        gap: COMPONENT_GAP,
    },
    modernTitle: {
        fontFamily: fontFamilies.interBold,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 42,
        lineHeight: 50.4, // 42 * 1.2
        textAlign: 'left',
        letterSpacing: -0.5,
    },
    modernSubtitle: {
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'left',
        maxWidth: 320,
        alignSelf: 'flex-start',
        opacity: 0.8,
    },
    section: {
        marginBottom: SECTION_GAP_LARGE,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 8,
        marginTop: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: fontFamilies.interSemiBold,
    },
    groupedSectionWrapper: {
        backgroundColor: 'transparent',
    },
});

export default React.memo(AccountSettingsScreen);
