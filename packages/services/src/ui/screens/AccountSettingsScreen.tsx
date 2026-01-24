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
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import { confirmAction } from '../utils/confirmAction';
import { useAuthStore } from '../stores/authStore';
import { GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme } from '../utils/themeUtils';
import type { ProfileFieldType } from './EditProfileFieldScreen';
import { getDisplayName } from '../utils/user-utils';
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


    // Get theme colors using centralized hook
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);

    // Extract colors for convenience - ensure it's always defined
    // useThemeStyles always returns colors, but add safety check for edge cases
    const colors = themeStyles.colors || Colors[normalizeColorScheme(colorScheme, theme || 'light')];


    // Track initialization to prevent unnecessary resets
    const isInitializedRef = useRef(false);
    const previousUserIdRef = useRef<string | null>(null);
    const previousAvatarRef = useRef<string | null>(null);

    // Load user data - only reset fields when user actually changes (not just avatar)
    useEffect(() => {
        if (finalUser) {
            const currentUserId = finalUser.id;
            const currentAvatar = typeof finalUser.avatar === 'string' ? finalUser.avatar : '';
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

    const handleAvatarRemove = () => {
        confirmAction(t('editProfile.confirms.removeAvatar') || 'Remove your profile picture?', () => {
            setAvatarFileId('');
            toast.success(t('editProfile.toasts.avatarRemoved') || 'Avatar removed');
        });
    };

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
            <View style={[styles.container, {
                backgroundColor: themeStyles.backgroundColor,
                justifyContent: 'center'
            }]}>
                <ActivityIndicator size="large" color={themeStyles.primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <ScrollView
                ref={scrollViewRef}
                style={styles.content}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {/* Title and Subtitle Header */}
                <View style={[styles.headerContainer, styles.headerSection]}>
                            <Text style={[styles.modernTitle, { color: themeStyles.textColor, marginBottom: 0, marginTop: 0 }]}>
                                {t('accountOverview.items.editProfile.title') || t('editProfile.title') || 'Edit Profile'}
                            </Text>
                            <Text style={[styles.modernSubtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>
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
                            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
                                {t('editProfile.sections.profilePicture') || 'PROFILE PICTURE'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'profile-photo',
                                            customIcon: (optimisticAvatarId || avatarFileId) ? (
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
                                            ) : undefined,
                                            icon: !(optimisticAvatarId || avatarFileId) ? 'account-outline' : undefined,
                                            iconColor: colors.sidebarIconPersonalInfo,
                                            title: 'Profile Photo',
                                            subtitle: isUpdatingAvatar
                                                ? 'Updating profile picture...'
                                                : (avatarFileId ? 'Tap to change your profile picture' : 'Tap to add a profile picture'),
                                            onPress: isUpdatingAvatar ? undefined : openAvatarPicker,
                                            disabled: isUpdatingAvatar,
                                        },
                                        ...(avatarFileId && !isUpdatingAvatar ? [
                                            {
                                                id: 'remove-profile-photo',
                                                icon: 'delete-outline',
                                                iconColor: colors.sidebarIconSharing,
                                                title: 'Remove Photo',
                                                subtitle: 'Delete current profile picture',
                                                onPress: handleAvatarRemove,
                                            }
                                        ] : []),
                                    ]}
                                />
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
                            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
                                {t('editProfile.sections.basicInfo') || 'BASIC INFORMATION'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'display-name',
                                            icon: 'account-outline',
                                            iconColor: colors.sidebarIconPersonalInfo,
                                            title: t('editProfile.items.displayName.title') || 'Display Name',
                                            subtitle: [displayName, lastName].filter(Boolean).join(' ') || (t('editProfile.items.displayName.add') || 'Add your display name'),
                                            onPress: handleOpenDisplayNameModal,
                                        },
                                        {
                                            id: 'username',
                                            icon: 'at',
                                            iconColor: colors.sidebarIconData,
                                            title: t('editProfile.items.username.title') || 'Username',
                                            subtitle: username || (t('editProfile.items.username.choose') || 'Choose a username'),
                                            onPress: handleOpenUsernameModal,
                                        },
                                        {
                                            id: 'email',
                                            icon: 'email-outline',
                                            iconColor: colors.sidebarIconSecurity,
                                            title: t('editProfile.items.email.title') || 'Email',
                                            subtitle: email || (t('editProfile.items.email.add') || 'Add your email address'),
                                            onPress: handleOpenEmailModal,
                                        },
                                    ]}
                                />
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
                            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
                                {t('editProfile.sections.about') || 'ABOUT YOU'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'bio',
                                            icon: 'text-box-outline',
                                            iconColor: colors.sidebarIconPersonalInfo,
                                            title: t('editProfile.items.bio.title') || 'Bio',
                                            subtitle: bio || (t('editProfile.items.bio.placeholder') || 'Tell people about yourself'),
                                            onPress: handleOpenBioModal,
                                        },
                                        {
                                            id: 'locations',
                                            icon: 'map-marker-outline',
                                            iconColor: colors.sidebarIconSharing,
                                            title: t('editProfile.items.locations.title') || 'Locations',
                                            subtitle: locations.length > 0
                                                ? (locations.length === 1
                                                    ? (t('editProfile.items.locations.count', { count: locations.length }) || `${locations.length} location added`)
                                                    : (t('editProfile.items.locations.count_plural', { count: locations.length }) || `${locations.length} locations added`))
                                                : (t('editProfile.items.locations.add') || 'Add your locations'),
                                            onPress: handleOpenLocationModal,
                                        },
                                        {
                                            id: 'links',
                                            icon: 'link-variant',
                                            iconColor: colors.sidebarIconSharing,
                                            title: t('editProfile.items.links.title') || 'Links',
                                            subtitle: linksMetadata.length > 0
                                                ? (linksMetadata.length === 1
                                                    ? (t('editProfile.items.links.count', { count: linksMetadata.length }) || `${linksMetadata.length} link added`)
                                                    : (t('editProfile.items.links.count_plural', { count: linksMetadata.length }) || `${linksMetadata.length} links added`))
                                                : (t('editProfile.items.links.add') || 'Add your links'),
                                            onPress: handleOpenLinksModal,
                                        },
                                    ]}
                                />
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
                            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
                                {t('editProfile.sections.quickActions') || 'QUICK ACTIONS'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'preview-profile',
                                            icon: 'eye',
                                            iconColor: colors.sidebarIconHome,
                                            title: t('editProfile.items.previewProfile.title') || 'Preview Profile',
                                            subtitle: t('editProfile.items.previewProfile.subtitle') || 'See how your profile looks to others',
                                            onPress: () => navigate?.('Profile', { userId: finalUser?.id }),
                                        },
                                        {
                                            id: 'privacy-settings',
                                            icon: 'shield-check',
                                            iconColor: colors.sidebarIconSecurity,
                                            title: t('editProfile.items.privacySettings.title') || 'Privacy Settings',
                                            subtitle: t('editProfile.items.privacySettings.subtitle') || 'Control who can see your profile',
                                            onPress: () => navigate?.('PrivacySettings'),
                                        },
                                        {
                                            id: 'verify-account',
                                            icon: 'check-circle',
                                            iconColor: colors.sidebarIconPersonalInfo,
                                            title: t('editProfile.items.verifyAccount.title') || 'Verify Account',
                                            subtitle: t('editProfile.items.verifyAccount.subtitle') || 'Get a verified badge',
                                            onPress: () => navigate?.('AccountVerification'),
                                        },
                                    ]}
                                />
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
                            <Text style={[styles.sectionTitle, { color: colors.secondaryText }]}>
                                {t('editProfile.sections.security') || 'SECURITY'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                            </View>
                        </View>
            </ScrollView>
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
    scrollView: {
        flexShrink: 1,
    },
    contentEditing: {
        flex: 1,
        padding: 0,
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
        fontFamily: fontFamilies.phuduBold,
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
        color: '#8E8E93',
        marginBottom: 8,
        marginTop: 4,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    groupedSectionWrapper: {
        backgroundColor: 'transparent',
    },

    userIcon: {
        marginRight: 12,
    },

    // Editing-only mode styles
    editingOnlyContainer: {
        flex: 1,
    },
    editingFieldContainer: {
        backgroundColor: '#fff',
        padding: 16,
        flex: 1,
    },
    editingFieldHeader: {
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
    },
    editingFieldTitleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    editingFieldIcon: {
        marginRight: 12,
    },
    editingFieldTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#000',
    },
    editingFieldContent: {
        flex: 1,
    },
    newValueSection: {
        flex: 1,
    },
    editingFieldLabel: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 8,
        fontFamily: fontFamilies.phuduSemiBold,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    editingFieldInput: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 16,
        fontSize: 17,
        minHeight: 52,
        fontWeight: '400',
        letterSpacing: -0.2,
    },
    editingFieldDescription: {
        fontSize: 14,
        color: '#666',
        marginBottom: 16,
    },
    primaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        // backgroundColor should be applied inline using colors.iconSecurity
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 10,
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
    editingFieldTextArea: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 14,
        padding: 16,
        fontSize: 17,
        minHeight: 120,
        textAlignVertical: 'top',
        fontWeight: '400',
        letterSpacing: -0.2,
    },
    // Custom editing header styles
    editingHeader: {
        paddingTop: Platform.OS === 'ios' ? 50 : 16,
        paddingBottom: 0,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    editingHeaderContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        minHeight: 44,
    },
    editingBackButton: {
        width: 36,
        height: 36,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 12,
    },
    editingTitleContainer: {
        flex: 1,
        flexDirection: 'column',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
        paddingBottom: 8,
    },
    editingTitleIcon: {
        marginBottom: 4,
        alignSelf: 'flex-start',
    },
    editingTitle: {
        fontSize: 18,
        fontWeight: '700',
        fontFamily: fontFamilies.phuduBold,
        letterSpacing: -0.3,
        lineHeight: 22,
        textAlign: 'left',
        alignSelf: 'flex-start',
    },
    editingSaveButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        minWidth: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    editingSaveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    editingHeaderBottom: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        paddingHorizontal: 20,
        paddingBottom: 20,
        paddingTop: 24,
    },
    editingIconContainer: {
        width: 64,
        height: 64,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 16,
    },
    editingBottomTitle: {
        fontSize: 28,
        fontWeight: '700',
        fontFamily: fontFamilies.phuduBold,
        letterSpacing: -0.5,
        lineHeight: 34,
        textAlign: 'left',
        alignSelf: 'flex-start',
    },
    // Links management styles
    addLinkSection: {
        marginBottom: 16,
        padding: 12,
        backgroundColor: '#F8F9FA',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E9ECEF',
    },
    addLinkLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 8,
    },
    addLinkInputContainer: {
        gap: 8,
    },
    addLinkInput: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#E9ECEF',
        borderRadius: 6,
        padding: 10,
        fontSize: 14,
        minHeight: 36,
    },
    addLinkButtons: {
        flexDirection: 'row',
        gap: 6,
    },
    addLinkButton: {
        flex: 1,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelButton: {
        backgroundColor: '#F8F9FA',
        borderWidth: 1,
        borderColor: '#E9ECEF',
    },
    cancelButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6C757D',
    },
    addButton: {
        // backgroundColor should be applied inline using colors.iconSecurity
    },
    addButtonText: {
        fontSize: 14,
        fontWeight: '600',
        color: '#fff',
    },
    addLinkTrigger: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#F8F9FA',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E9ECEF',
        borderStyle: 'dashed',
        marginBottom: 16,
    },
    addLinkTriggerText: {
        fontSize: 14,
        fontWeight: '600',
        // color should be applied inline using colors.iconSecurity
        marginLeft: 6,
    },
    linksList: {
        gap: 8,
    },
    linksListTitle: {
        fontSize: 16,
        fontWeight: '700',
        color: '#333',
        marginBottom: 6,
    },
    linkItem: {
        backgroundColor: '#fff',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E9ECEF',
        overflow: 'hidden',
    },
    linkItemContent: {
        flexDirection: 'row',
        padding: 12,
        alignItems: 'center',
    },
    linkItemDragHandle: {
        width: 24,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    linkItemInfo: {
        flex: 1,
        marginRight: 8,
    },
    linkItemTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 2,
    },
    linkItemDescription: {
        fontSize: 12,
        color: '#666',
        marginBottom: 2,
    },
    linkItemUrl: {
        fontSize: 12,
        color: '#6C757D',
    },
    linkItemActions: {
        flexDirection: 'row',
        gap: 6,
    },
    linkItemButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#F8F9FA',
        alignItems: 'center',
        justifyContent: 'center',
    },
    linkItemDivider: {
        height: 1,
        backgroundColor: '#E9ECEF',
        marginHorizontal: 12,
    },
    reorderHint: {
        padding: 8,
        alignItems: 'center',
    },
    reorderHintText: {
        fontSize: 12,
        color: '#999',
        fontStyle: 'italic',
    },
    reorderButtons: {
        flexDirection: 'column',
        gap: 2,
    },
    reorderButton: {
        width: 20,
        height: 16,
        borderRadius: 3,
        backgroundColor: '#F8F9FA',
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#E9ECEF',
    },
    reorderButtonDisabled: {
        opacity: 0.3,
    },
    linkItemImage: {
        width: 32,
        height: 32,
        borderRadius: 16,
        // backgroundColor should be applied inline using colors.iconSecurity
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    linkItemImageText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#fff',
    },
    fetchingText: {
        fontSize: 12,
        // color should be applied inline using colors.iconSecurity
        fontStyle: 'italic',
    },
    linksFieldContent: {
        flex: 1,
        marginLeft: 12,
    },
    linksPreview: {
        marginTop: 4,
        flexDirection: 'column',
    },
    linksPreviewContainer: {
        marginTop: 4,
        flexDirection: 'column',
        width: '100%',
    },
    linkPreviewItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    linkPreviewImage: {
        width: 20,
        height: 20,
        borderRadius: 10,
        // backgroundColor should be applied inline using colors.iconSecurity
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 6,
    },
    linkPreviewImageText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#fff',
    },
    linkPreviewTitle: {
        fontSize: 13,
        color: '#666',
        flex: 1,
    },
    linkPreviewContent: {
        flex: 1,
    },
    linkPreviewSubtitle: {
        fontSize: 11,
        color: '#999',
        marginTop: 1,
    },
    linkPreviewMore: {
        fontSize: 12,
        color: '#999',
        fontStyle: 'italic',
    },
    // Location management styles
    addLocationSection: {
        marginBottom: 16,
    },
    addLocationLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 8,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    searchingText: {
        fontSize: 12,
        // color should be applied inline using colors.iconSecurity
        fontStyle: 'italic',
    },
    addLocationInputContainer: {
        marginBottom: 8,
    },
    addLocationInput: {
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#e0e0e0',
        borderRadius: 12,
        padding: 16,
        fontSize: 17,
        minHeight: 52,
        fontWeight: '400',
        marginBottom: 8,
    },
    addLocationButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    addLocationButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    addLocationTrigger: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        backgroundColor: '#F8F9FA',
        borderRadius: 8,
        marginBottom: 16,
    },
    addLocationTriggerText: {
        marginLeft: 8,
        fontSize: 16,
        // color should be applied inline using colors.iconSecurity
        fontWeight: '500',
    },
    searchResults: {
        backgroundColor: '#fff',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 8,
        maxHeight: 200,
    },
    searchResultItem: {
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    searchResultName: {
        fontSize: 14,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    searchResultType: {
        fontSize: 12,
        color: '#666',
        textTransform: 'capitalize',
    },
    locationsList: {
        marginTop: 8,
    },
    locationsListTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    locationItem: {
        marginBottom: 8,
    },
    locationItemContent: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: '#F8F9FA',
        borderRadius: 8,
    },
    locationItemDragHandle: {
        marginRight: 12,
    },
    locationItemInfo: {
        flex: 1,
    },
    locationItemHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    locationItemName: {
        fontSize: 14,
        fontWeight: '500',
        color: '#333',
        flex: 1,
    },
    locationLabel: {
        // backgroundColor should be applied inline using colors.iconSecurity
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        marginLeft: 8,
    },
    locationLabelText: {
        fontSize: 10,
        fontWeight: '600',
        color: '#fff',
        textTransform: 'uppercase',
    },
    locationCoordinates: {
        fontSize: 12,
        color: '#666',
        fontFamily: 'monospace',
    },
    locationItemActions: {
        marginLeft: 8,
    },
    locationItemButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: '#F8F9FA',
        alignItems: 'center',
        justifyContent: 'center',
    },
    locationItemDivider: {
        height: 1,
        backgroundColor: '#E9ECEF',
        marginHorizontal: 12,
    },
});

export default React.memo(AccountSettingsScreen);
