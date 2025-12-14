import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    ScrollView,
    Alert,
    TextInput,
    Animated,
    Platform,
    Image,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import Avatar from '../components/Avatar';
import type { FileMetadata } from '../../models/interfaces';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
// @ts-ignore - MaterialCommunityIcons is available at runtime
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import { confirmAction } from '../utils/confirmAction';
import { useAuthStore } from '../stores/authStore';
import { Header, GroupedSection, Section } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme, normalizeTheme } from '../utils/themeUtils';
import { useHapticPress } from '../hooks/use-haptic-press';
import { EditDisplayNameModal } from '../components/profile/EditDisplayNameModal';
import { EditUsernameModal } from '../components/profile/EditUsernameModal';
import { EditEmailModal } from '../components/profile/EditEmailModal';
import { EditBioModal } from '../components/profile/EditBioModal';
import { EditLocationModal } from '../components/profile/EditLocationModal';
import { EditLinksModal } from '../components/profile/EditLinksModal';
import { getDisplayName } from '../utils/user-utils';
import { TTLCache, registerCacheForCleanup } from '../../utils/cache';
import { useOxy } from '../context/OxyContext';
import {
    SCREEN_PADDING_HORIZONTAL,
    SCREEN_PADDING_VERTICAL,
    SECTION_GAP,
    SECTION_GAP_LARGE,
    COMPONENT_GAP,
    HEADER_PADDING_TOP_SETTINGS,
    createScreenContentStyle,
} from '../constants/spacing';

// Caches for link metadata and location searches
const linkMetadataCache = new TTLCache<any>(30 * 60 * 1000); // 30 minutes cache for link metadata
const locationSearchCache = new TTLCache<any[]>(60 * 60 * 1000); // 1 hour cache for location searches
registerCacheForCleanup(linkMetadataCache);
registerCacheForCleanup(locationSearchCache);


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
        user: userFromContext,
        oxyServices,
        isLoading: authLoading,
        isAuthenticated,
        activeSessionId,
    } = useOxy();
    const { t } = useI18n();
    const normalizedTheme = normalizeTheme(theme);
    const updateUser = useAuthStore((state) => state.updateUser);
    // Get user directly from store to ensure reactivity to avatar changes
    const user = useAuthStore((state) => state.user) || userFromContext;
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isUpdatingAvatar, setIsUpdatingAvatar] = useState(false);
    const [optimisticAvatarId, setOptimisticAvatarId] = useState<string | null>(null);
    const scrollViewRef = useRef<ScrollView>(null);
    const avatarSectionRef = useRef<View>(null);
    const [avatarSectionY, setAvatarSectionY] = useState<number | null>(null);

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


    // Animation refs
    const saveButtonScale = useRef(new Animated.Value(1)).current;

    // Form state
    const [displayName, setDisplayName] = useState('');
    const [lastName, setLastName] = useState('');
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [bio, setBio] = useState('');
    const [location, setLocation] = useState('');
    const [links, setLinks] = useState<string[]>([]);
    const [avatarFileId, setAvatarFileId] = useState('');

    // Modal visibility states
    const [showEditDisplayNameModal, setShowEditDisplayNameModal] = useState(false);
    const [showEditUsernameModal, setShowEditUsernameModal] = useState(false);
    const [showEditEmailModal, setShowEditEmailModal] = useState(false);
    const [showEditBioModal, setShowEditBioModal] = useState(false);
    const [showEditLocationModal, setShowEditLocationModal] = useState(false);
    const [showEditLinksModal, setShowEditLinksModal] = useState(false);

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

    // State for inline editing (used by old renderEditingField code)
    const [editingField, setEditingField] = useState<string | null>(null);
    const [tempDisplayName, setTempDisplayName] = useState('');
    const [tempLastName, setTempLastName] = useState('');
    const [tempUsername, setTempUsername] = useState('');
    const [tempEmail, setTempEmail] = useState('');
    const [tempBio, setTempBio] = useState('');
    const [tempLocation, setTempLocation] = useState('');
    const [tempLinks, setTempLinks] = useState<string[]>([]);
    const [tempLocations, setTempLocations] = useState<Array<{
        id: string;
        name: string;
        label?: string;
        coordinates?: { lat: number; lon: number };
    }>>([]);
    const [tempLinksWithMetadata, setTempLinksWithMetadata] = useState<Array<{
        url: string;
        title?: string;
        description?: string;
        image?: string;
        id: string;
    }>>([]);
    const [isAddingLocation, setIsAddingLocation] = useState(false);
    const [isSearchingLocations, setIsSearchingLocations] = useState(false);
    const [locationSearchResults, setLocationSearchResults] = useState<any[]>([]);
    const [newLocationQuery, setNewLocationQuery] = useState('');
    const [isAddingLink, setIsAddingLink] = useState(false);
    const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
    const [newLinkUrl, setNewLinkUrl] = useState('');

    // Get theme colors using centralized hook
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    const handlePressIn = useHapticPress();

    // Extract colors for convenience - ensure it's always defined
    // useThemeStyles always returns colors, but add safety check for edge cases
    const colors = themeStyles.colors || Colors[normalizeColorScheme(colorScheme, theme || 'light')];

    // Memoize onBack handler to provide stable reference for Reanimated
    const handleBack = useMemo(() => {
        return goBack || onClose || undefined;
    }, [goBack, onClose]);

    // Memoize animation function to prevent recreation on every render
    const animateSaveButton = useCallback((toValue: number, onComplete?: () => void) => {
        Animated.spring(saveButtonScale, {
            toValue,
            useNativeDriver: Platform.OS !== 'web',
            tension: 150,
            friction: 8,
        }).start(onComplete ? (finished) => {
            if (finished) {
                onComplete();
            }
        } : undefined);
    }, [saveButtonScale]);

    // Track initialization to prevent unnecessary resets
    const isInitializedRef = useRef(false);
    const previousUserIdRef = useRef<string | null>(null);
    const previousAvatarRef = useRef<string | null>(null);

    // Load user data - only reset fields when user actually changes (not just avatar)
    useEffect(() => {
        if (user) {
            const currentUserId = user.id;
            const currentAvatar = typeof user.avatar === 'string' ? user.avatar : '';
            const isNewUser = previousUserIdRef.current !== currentUserId;
            const isAvatarOnlyUpdate = !isNewUser && previousUserIdRef.current === currentUserId &&
                previousAvatarRef.current !== currentAvatar &&
                previousAvatarRef.current !== null;
            const shouldInitialize = !isInitializedRef.current || isNewUser;

            // Only reset all fields if it's a new user or first load
            // Skip reset if it's just an avatar update
            if (shouldInitialize && !isAvatarOnlyUpdate) {
                const userDisplayName = typeof user.name === 'string'
                    ? user.name
                    : user.name?.first || user.name?.full || '';
                const userLastName = typeof user.name === 'object' ? user.name?.last || '' : '';
                setDisplayName(userDisplayName);
                setLastName(userLastName);
                setUsername(user.username || '');
                setEmail(user.email || '');
                setBio(user.bio || '');
                setLocation(user.location || '');

                // Handle locations - convert single location to array format
                if (user.locations && Array.isArray(user.locations)) {
                    setLocations(user.locations.map((loc, index) => ({
                        id: loc.id || `existing-${index}`,
                        name: loc.name,
                        label: loc.label,
                        coordinates: loc.coordinates
                    })));
                } else if (user.location) {
                    // Convert single location string to array format
                    setLocations([{
                        id: 'existing-0',
                        name: user.location,
                        label: 'Location'
                    }]);
                } else {
                    setLocations([]);
                }

                // Handle links - simple and direct like other fields
                if (user.linksMetadata && Array.isArray(user.linksMetadata)) {
                    const urls = user.linksMetadata.map(l => l.url);
                    setLinks(urls);
                    const metadataWithIds = user.linksMetadata.map((link, index) => ({
                        ...link,
                        id: link.id || `existing-${index}`
                    }));
                    setLinksMetadata(metadataWithIds);
                } else if (Array.isArray(user.links)) {
                    const simpleLinks = user.links.map(l => typeof l === 'string' ? l : l.link).filter(Boolean);
                    setLinks(simpleLinks);
                    const linksWithMetadata = simpleLinks.map((url, index) => ({
                        url,
                        title: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        description: `Link to ${url}`,
                        image: undefined,
                        id: `existing-${index}`
                    }));
                    setLinksMetadata(linksWithMetadata);
                } else if (user.website) {
                    setLinks([user.website]);
                    setLinksMetadata([{
                        url: user.website,
                        title: user.website.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        description: `Link to ${user.website}`,
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
    }, [user, avatarFileId, isUpdatingAvatar, optimisticAvatarId]);

    // Set initial editing field if provided via props (e.g., from navigation)
    // Use a ref to track if we've already set the initial field to avoid loops
    const hasSetInitialFieldRef = useRef(false);
    const previousInitialFieldRef = useRef<string | undefined>(undefined);
    const initialFieldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Delay constant for scroll completion
    const SCROLL_DELAY_MS = 600;

    // Helper functions for inline editing (legacy support)
    const startEditing = useCallback((field: string, initialValue: string) => {
        setEditingField(field);
        switch (field) {
            case 'displayName':
                setTempDisplayName(initialValue || displayName);
                setTempLastName(lastName);
                break;
            case 'username':
                setTempUsername(initialValue || username);
                break;
            case 'email':
                setTempEmail(initialValue || email);
                break;
            case 'bio':
                setTempBio(initialValue || bio);
                break;
            case 'location':
                setTempLocations([...locations]);
                break;
            case 'links':
                setTempLinksWithMetadata([...linksMetadata]);
                break;
        }
    }, [displayName, lastName, username, email, bio, locations, linksMetadata]);

    const cancelEditing = useCallback(() => {
        setEditingField(null);
        setTempDisplayName('');
        setTempLastName('');
        setTempUsername('');
        setTempEmail('');
        setTempBio('');
        setTempLocation('');
        setTempLinks([]);
        setTempLocations([]);
        setTempLinksWithMetadata([]);
        setIsAddingLocation(false);
        setIsSearchingLocations(false);
        setLocationSearchResults([]);
        setNewLocationQuery('');
        setIsAddingLink(false);
        setIsFetchingMetadata(false);
        setNewLinkUrl('');
    }, []);

    const saveField = useCallback(async (field: string | null) => {
        if (!field) return;

        setIsSaving(true);
        try {
            switch (field) {
                case 'displayName':
                    await updateUser({ name: { first: tempDisplayName, last: tempLastName } }, oxyServices);
                    setDisplayName(tempDisplayName);
                    setLastName(tempLastName);
                    break;
                case 'username':
                    await updateUser({ username: tempUsername }, oxyServices);
                    setUsername(tempUsername);
                    break;
                case 'email':
                    await updateUser({ email: tempEmail }, oxyServices);
                    setEmail(tempEmail);
                    break;
                case 'bio':
                    await updateUser({ bio: tempBio }, oxyServices);
                    setBio(tempBio);
                    break;
                case 'location':
                    await updateUser({ locations: tempLocations }, oxyServices);
                    setLocations(tempLocations);
                    break;
                case 'links':
                    await updateUser({ linksMetadata: tempLinksWithMetadata }, oxyServices);
                    setLinksMetadata(tempLinksWithMetadata);
                    setLinks(tempLinksWithMetadata.map(l => l.url));
                    break;
            }
            setEditingField(null);
            toast.success(t('editProfile.toasts.saved') || 'Saved');
        } catch (error: any) {
            toast.error(error?.message || (t('editProfile.toasts.saveFailed') || 'Failed to save'));
        } finally {
            setIsSaving(false);
        }
    }, [tempDisplayName, tempLastName, tempUsername, tempEmail, tempBio, tempLocations, tempLinksWithMetadata, updateUser, oxyServices, t]);

    // Helper to get current value for a field
    const getFieldCurrentValue = useCallback((field: string): string => {
        switch (field) {
            case 'displayName':
                return displayName;
            case 'username':
                return username;
            case 'email':
                return email;
            case 'bio':
                return bio;
            case 'location':
            case 'links':
            default:
                return '';
        }
    }, [displayName, username, email, bio]);

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

    const handleSave = async () => {
        if (!user) return;

        try {
            setIsSaving(true);
            animateSaveButton(0.95); // Scale down slightly for animation

            const updates: Record<string, any> = {
                username,
                email,
                bio,
                location: locations.length > 0 ? locations[0].name : '', // Keep backward compatibility
                locations: locations.length > 0 ? locations : undefined,
                links,
                linksMetadata: linksMetadata.length > 0 ? linksMetadata : undefined,
            };

            // Handle name field
            if (displayName || lastName) {
                updates.name = { first: displayName, last: lastName };
            }

            // Handle avatar
            if (avatarFileId !== (typeof user.avatar === 'string' ? user.avatar : '')) {
                updates.avatar = avatarFileId;
            }

            await updateUser(updates, oxyServices);
            toast.success(t('editProfile.toasts.profileUpdated') || 'Profile updated successfully');

            animateSaveButton(1); // Scale back to normal

            if (onClose) {
                onClose();
            } else if (goBack) {
                goBack();
            }
        } catch (error: any) {
            toast.error(error.message || t('editProfile.toasts.updateFailed') || 'Failed to update profile');
            animateSaveButton(1); // Scale back to normal on error
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarRemove = () => {
        confirmAction(t('editProfile.confirms.removeAvatar') || 'Remove your profile picture?', () => {
            setAvatarFileId('');
            toast.success(t('editProfile.toasts.avatarRemoved') || 'Avatar removed');
        });
    };

    const openAvatarPicker = useCallback(() => {
        toast.info?.(t('editProfile.toasts.avatarPickerUnavailable') || 'Avatar picker is not available in this build.');
    }, [t]);

    // Handlers to open modals
    const handleOpenDisplayNameModal = useCallback(() => setShowEditDisplayNameModal(true), []);
    const handleOpenUsernameModal = useCallback(() => setShowEditUsernameModal(true), []);
    const handleOpenEmailModal = useCallback(() => setShowEditEmailModal(true), []);
    const handleOpenBioModal = useCallback(() => setShowEditBioModal(true), []);
    const handleOpenLocationModal = useCallback(() => setShowEditLocationModal(true), []);
    const handleOpenLinksModal = useCallback(() => setShowEditLinksModal(true), []);

    // Handler to refresh data after modal saves
    // Note: Access user directly from store when invoked to get latest value,
    // not from closure which may be stale after modal saves update the backend
    const handleModalSave = useCallback(() => {
        // Get fresh user data from store to ensure we have the latest values
        // after the modal's save operation updates the backend
        // Read from store directly (not from closure) to avoid stale data
        const currentUser = useAuthStore.getState().user;

        // Reload user data to reflect changes
        if (currentUser) {
            const userDisplayName = typeof currentUser.name === 'string'
                ? currentUser.name
                : currentUser.name?.first || currentUser.name?.full || '';
            const userLastName = typeof currentUser.name === 'object' ? currentUser.name?.last || '' : '';
            setDisplayName(userDisplayName);
            setLastName(userLastName);
            setUsername(currentUser.username || '');
            setEmail(currentUser.email || '');
            setBio(currentUser.bio || '');

            // Reload locations and links
            if (currentUser.locations && Array.isArray(currentUser.locations)) {
                setLocations(currentUser.locations.map((loc, index) => ({
                    id: loc.id || `existing-${index}`,
                    name: loc.name,
                    label: loc.label,
                    coordinates: loc.coordinates
                })));
            } else if (currentUser.location) {
                setLocations([{
                    id: 'existing-0',
                    name: currentUser.location,
                    label: 'Location'
                }]);
            } else {
                setLocations([]);
            }

            if (currentUser.linksMetadata && Array.isArray(currentUser.linksMetadata)) {
                setLinksMetadata(currentUser.linksMetadata.map((link, index) => ({
                    ...link,
                    id: link.id || `existing-${index}`
                })));
            } else {
                setLinksMetadata([]);
            }
        }
    }, []); // Empty dependency array - callback reads fresh data from store at call time

    // Handle initialField prop - open appropriate modal
    useEffect(() => {
        if (initialField) {
            // Special handling for avatar - open avatar picker directly
            if (initialField === 'avatar') {
                setTimeout(() => {
                    openAvatarPicker();
                }, 300);
            } else {
                // Open appropriate modal
                setTimeout(() => {
                    switch (initialField) {
                        case 'displayName':
                            setShowEditDisplayNameModal(true);
                            break;
                        case 'username':
                            setShowEditUsernameModal(true);
                            break;
                        case 'email':
                            setShowEditEmailModal(true);
                            break;
                        case 'bio':
                            setShowEditBioModal(true);
                            break;
                        case 'location':
                            setShowEditLocationModal(true);
                            break;
                        case 'links':
                            setShowEditLinksModal(true);
                            break;
                    }
                }, 300);
            }
        }
    }, [initialField, openAvatarPicker]);




    // Removed fetchLinkMetadata - now handled by EditLinksModal
    const _fetchLinkMetadata = async (url: string) => {
        // Check cache first
        const cacheKey = url.toLowerCase().trim();
        const cached = linkMetadataCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        try {
            setIsFetchingMetadata(true);

            // Use the backend API to fetch metadata
            const metadata = await oxyServices.fetchLinkMetadata(url);

            const result = {
                ...metadata,
                id: Date.now().toString()
            };

            // Cache the result
            linkMetadataCache.set(cacheKey, result);
            return result;
        } catch (error) {
            // Fallback to basic metadata
            const fallback = {
                url: url.startsWith('http') ? url : 'https://' + url,
                title: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                description: 'Link',
                image: undefined,
                id: Date.now().toString()
            };
            // Cache fallback too (shorter TTL)
            linkMetadataCache.set(cacheKey, fallback, 5 * 60 * 1000); // 5 minutes for fallbacks
            return fallback;
        } finally {
            setIsFetchingMetadata(false);
        }
    };

    // Helper functions for inline editing (legacy support - still used by renderEditingField)
    const searchLocations = async (query: string) => {
        if (!query.trim() || query.length < 3) {
            setLocationSearchResults([]);
            return;
        }

        // Check cache first
        const cacheKey = query.toLowerCase().trim();
        const cached = locationSearchCache.get(cacheKey);
        if (cached) {
            setLocationSearchResults(cached);
            return;
        }

        try {
            setIsSearchingLocations(true);
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
            );
            const data = await response.json();

            // Cache the results
            locationSearchCache.set(cacheKey, data);
            setLocationSearchResults(data);
        } catch (error) {
            setLocationSearchResults([]);
        } finally {
            setIsSearchingLocations(false);
        }
    };

    const addLocation = (locationData: {
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
        type: string;
    }) => {
        const newLocation = {
            id: Date.now().toString(),
            name: locationData.display_name,
            label: locationData.type === 'city' ? 'City' :
                locationData.type === 'country' ? 'Country' :
                    locationData.type === 'state' ? 'State' : 'Location',
            coordinates: {
                lat: Number.parseFloat(locationData.lat),
                lon: Number.parseFloat(locationData.lon)
            }
        };

        setTempLocations(prev => [...prev, newLocation]);
        setNewLocationQuery('');
        setLocationSearchResults([]);
        setIsAddingLocation(false);
    };

    const removeLocation = (id: string) => {
        setTempLocations(prev => prev.filter(loc => loc.id !== id));
    };

    const moveLocation = (fromIndex: number, toIndex: number) => {
        setTempLocations(prev => {
            const newLocations = [...prev];
            const [movedLocation] = newLocations.splice(fromIndex, 1);
            newLocations.splice(toIndex, 0, movedLocation);
            return newLocations;
        });
    };

    const addLink = async () => {
        if (!newLinkUrl.trim()) return;

        const url = newLinkUrl.trim();
        const metadata = await _fetchLinkMetadata(url);

        setTempLinksWithMetadata(prev => [...prev, metadata]);
        setNewLinkUrl('');
        setIsAddingLink(false);
    };

    const removeLink = (id: string) => {
        setTempLinksWithMetadata(prev => prev.filter(link => link.id !== id));
    };

    const moveLink = (fromIndex: number, toIndex: number) => {
        setTempLinksWithMetadata(prev => {
            const newLinks = [...prev];
            const [movedLink] = newLinks.splice(fromIndex, 1);
            newLinks.splice(toIndex, 0, movedLink);
            return newLinks;
        });
    };

    // Memoize display name for avatar
    const displayNameForAvatar = useMemo(() => getDisplayName(user), [user]);

    // Legacy renderEditingField function (fallback)
    const renderEditingField = (type: string | null) => {
        if (!type) return null;
        if (type === 'displayName') {
            return (
                <View style={[styles.editingFieldContainer, { backgroundColor: colors.background }]}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={[styles.editingFieldLabel, { color: colors.text }]}>Edit Full Name</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 12 }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.editingFieldLabel}>First Name</Text>
                                    <TextInput
                                        style={styles.editingFieldInput}
                                        value={tempDisplayName}
                                        onChangeText={setTempDisplayName}
                                        placeholder="Enter your first name"
                                        placeholderTextColor={colors.secondaryText}
                                        autoFocus
                                        selectionColor={themeStyles.primaryColor}
                                    />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.editingFieldLabel}>Last Name</Text>
                                    <TextInput
                                        style={styles.editingFieldInput}
                                        value={tempLastName}
                                        onChangeText={setTempLastName}
                                        placeholder="Enter your last name"
                                        placeholderTextColor={colors.secondaryText}
                                        selectionColor={themeStyles.primaryColor}
                                    />
                                </View>
                            </View>
                        </View>
                    </View>
                </View>
            );
        }

        if (type === 'location') {
            return (
                <View style={[styles.editingFieldContainer, { backgroundColor: colors.background }]}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={[styles.editingFieldLabel, { color: colors.text }]}>Manage Your Locations</Text>
                            </View>

                            {/* Add new location section */}
                            {isAddingLocation ? (
                                <View style={styles.addLocationSection}>
                                    <Text style={styles.addLocationLabel}>
                                        Add New Location
                                        {isSearchingLocations && (
                                            <Text style={[styles.searchingText, { color: colors.iconSecurity }]}> • Searching...</Text>
                                        )}
                                    </Text>
                                    <View style={styles.addLocationInputContainer}>
                                        <TextInput
                                            style={styles.addLocationInput}
                                            value={newLocationQuery}
                                            onChangeText={(text) => {
                                                setNewLocationQuery(text);
                                                searchLocations(text);
                                            }}
                                            placeholder="Search for a location..."
                                            placeholderTextColor={colors.secondaryText}
                                            autoFocus
                                            selectionColor={themeStyles.primaryColor}
                                        />
                                        <View style={styles.addLocationButtons}>
                                            <TouchableOpacity
                                                style={[styles.addLocationButton, styles.cancelButton]}
                                                onPress={() => {
                                                    setIsAddingLocation(false);
                                                    setNewLocationQuery('');
                                                    setLocationSearchResults([]);
                                                }}
                                            >
                                                <Text style={styles.cancelButtonText}>Cancel</Text>
                                            </TouchableOpacity>
                                        </View>
                                    </View>

                                    {/* Search results */}
                                    {locationSearchResults.length > 0 && (
                                        <View style={styles.searchResults}>
                                            {locationSearchResults.map((result) => (
                                                <TouchableOpacity
                                                    key={result.place_id}
                                                    style={styles.searchResultItem}
                                                    onPress={() => addLocation(result)}
                                                >
                                                    <Text style={styles.searchResultName} numberOfLines={2}>
                                                        {result.display_name}
                                                    </Text>
                                                    <Text style={styles.searchResultType}>
                                                        {result.type}
                                                    </Text>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    )}
                                </View>
                            ) : (
                                <TouchableOpacity
                                    style={styles.addLocationTrigger}
                                    onPress={() => setIsAddingLocation(true)}
                                >
                                    <OxyIcon name="add" size={20} color={themeStyles.primaryColor} />
                                    <Text style={[styles.addLocationTriggerText, { color: colors.iconSecurity }]}>Add a new location</Text>
                                </TouchableOpacity>
                            )}

                            {/* Existing locations list */}
                            {tempLocations.length > 0 && (
                                <View style={styles.locationsList}>
                                    <Text style={styles.locationsListTitle}>Your Locations ({tempLocations.length})</Text>
                                    {tempLocations.map((location, index) => (
                                        <View key={location.id} style={styles.locationItem}>
                                            <View style={styles.locationItemContent}>
                                                <View style={styles.locationItemDragHandle}>
                                                    <View style={styles.reorderButtons}>
                                                        <TouchableOpacity
                                                            style={[styles.reorderButton, index === 0 && styles.reorderButtonDisabled]}
                                                            onPress={() => index > 0 && moveLocation(index, index - 1)}
                                                            disabled={index === 0}
                                                        >
                                                            <OxyIcon name="chevron-up" size={12} color={index === 0 ? "#ccc" : "#666"} />
                                                        </TouchableOpacity>
                                                        <TouchableOpacity
                                                            style={[styles.reorderButton, index === tempLocations.length - 1 && styles.reorderButtonDisabled]}
                                                            onPress={() => index < tempLocations.length - 1 && moveLocation(index, index + 1)}
                                                            disabled={index === tempLocations.length - 1}
                                                        >
                                                            <OxyIcon name="chevron-down" size={12} color={index === tempLocations.length - 1 ? "#ccc" : "#666"} />
                                                        </TouchableOpacity>
                                                    </View>
                                                </View>
                                                <View style={styles.locationItemInfo}>
                                                    <View style={styles.locationItemHeader}>
                                                        <Text style={styles.locationItemName} numberOfLines={1}>
                                                            {location.name}
                                                        </Text>
                                                        {location.label && (
                                                            <View style={[styles.locationLabel, { backgroundColor: colors.iconSecurity }]}>
                                                                <Text style={styles.locationLabelText}>
                                                                    {location.label}
                                                                </Text>
                                                            </View>
                                                        )}
                                                    </View>
                                                    {location.coordinates && (
                                                        <Text style={styles.locationCoordinates}>
                                                            {location.coordinates.lat.toFixed(4)}, {location.coordinates.lon.toFixed(4)}
                                                        </Text>
                                                    )}
                                                </View>
                                                <View style={styles.locationItemActions}>
                                                    <TouchableOpacity
                                                        style={styles.locationItemButton}
                                                        onPress={() => removeLocation(location.id)}
                                                    >
                                                        <OxyIcon name="trash" size={14} color="#FF3B30" />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                            {index < tempLocations.length - 1 && (
                                                <View style={styles.locationItemDivider} />
                                            )}
                                        </View>
                                    ))}
                                    <View style={styles.reorderHint}>
                                        <Text style={styles.reorderHintText}>Use ↑↓ buttons to reorder your locations</Text>
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                </View>
            );
        }

        if (type === 'links') {
            return (
                <View style={[styles.editingFieldContainer, { backgroundColor: colors.background }]}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={[styles.editingFieldLabel, { color: colors.text }]}>Manage Your Links</Text>
                            </View>

                            <GroupedSection
                                items={[
                                    // Add new link item
                                    ...(isAddingLink ? [{
                                        id: 'add-link-input',
                                        icon: 'plus',
                                        iconColor: colors.sidebarIconSharing,
                                        title: 'Add New Link',
                                        subtitle: isFetchingMetadata ? 'Fetching metadata...' : 'Enter URL to add a new link',
                                        customContent: (
                                            <View style={styles.addLinkInputContainer}>
                                                <TextInput
                                                    style={styles.addLinkInput}
                                                    value={newLinkUrl}
                                                    onChangeText={setNewLinkUrl}
                                                    placeholder="Enter URL (e.g., https://example.com)"
                                                    placeholderTextColor={colors.secondaryText}
                                                    keyboardType="url"
                                                    autoFocus
                                                    selectionColor={themeStyles.primaryColor}
                                                />
                                                <View style={styles.addLinkButtons}>
                                                    <TouchableOpacity
                                                        style={[styles.addLinkButton, styles.cancelButton]}
                                                        onPress={() => {
                                                            setIsAddingLink(false);
                                                            setNewLinkUrl('');
                                                        }}
                                                    >
                                                        <Text style={styles.cancelButtonText}>Cancel</Text>
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        style={[styles.addLinkButton, styles.addButton, { backgroundColor: colors.iconSecurity, opacity: isFetchingMetadata ? 0.5 : 1 }]}
                                                        onPress={addLink}
                                                        disabled={isFetchingMetadata}
                                                    >
                                                        {isFetchingMetadata ? (
                                                            <ActivityIndicator size="small" color="#fff" />
                                                        ) : (
                                                            <Text style={styles.addButtonText}>Add</Text>
                                                        )}
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                        ),
                                    }] : [{
                                        id: 'add-link-trigger',
                                        icon: 'plus',
                                        iconColor: colors.sidebarIconSharing,
                                        title: 'Add a new link',
                                        subtitle: 'Tap to add a new link to your profile',
                                        onPress: () => setIsAddingLink(true),
                                    }]),
                                    // Existing links
                                    ...tempLinksWithMetadata.map((link, index) => ({
                                        id: link.id,
                                        customIcon: link.image ? (
                                            <Image source={{ uri: link.image }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                                        ) : undefined,
                                        icon: !link.image ? 'link-variant' : undefined,
                                        iconColor: colors.sidebarIconSharing,
                                        title: link.title || link.url,
                                        subtitle: link.description && link.description !== link.title ? link.description : link.url,
                                        customContent: (
                                            <View style={styles.linkItemActions}>
                                                <View style={styles.reorderButtons}>
                                                    <TouchableOpacity
                                                        style={[styles.reorderButton, index === 0 && styles.reorderButtonDisabled]}
                                                        onPress={() => index > 0 && moveLink(index, index - 1)}
                                                        disabled={index === 0}
                                                    >
                                                        <OxyIcon name="chevron-up" size={12} color={index === 0 ? "#ccc" : "#666"} />
                                                    </TouchableOpacity>
                                                    <TouchableOpacity
                                                        style={[styles.reorderButton, index === tempLinksWithMetadata.length - 1 && styles.reorderButtonDisabled]}
                                                        onPress={() => index < tempLinksWithMetadata.length - 1 && moveLink(index, index + 1)}
                                                        disabled={index === tempLinksWithMetadata.length - 1}
                                                    >
                                                        <OxyIcon name="chevron-down" size={12} color={index === tempLinksWithMetadata.length - 1 ? "#ccc" : "#666"} />
                                                    </TouchableOpacity>
                                                </View>
                                                <TouchableOpacity
                                                    style={styles.linkItemButton}
                                                    onPress={() => removeLink(link.id)}
                                                >
                                                    <OxyIcon name="trash" size={14} color="#FF3B30" />
                                                </TouchableOpacity>
                                            </View>
                                        ),
                                    })),
                                ]}

                            />
                            {tempLinksWithMetadata.length > 0 && (
                                <View style={styles.reorderHint}>
                                    <Text style={styles.reorderHintText}>Use ↑↓ buttons to reorder your links</Text>
                                </View>
                            )}
                        </View>
                    </View>
                </View>
            );
        }
        const fieldConfig = {
            displayName: { label: 'Display Name', value: displayName, placeholder: 'Enter your display name', icon: 'person', color: colors.iconPersonalInfo, multiline: false, keyboardType: 'default' as const },
            username: { label: 'Username', value: username, placeholder: 'Choose a username', icon: 'at', color: colors.iconData, multiline: false, keyboardType: 'default' as const },
            email: { label: 'Email', value: email, placeholder: 'Enter your email address', icon: 'mail', color: colors.iconStorage, multiline: false, keyboardType: 'email-address' as const },
            bio: { label: 'Bio', value: bio, placeholder: 'Tell people about yourself...', icon: 'document-text', color: colors.iconPersonalInfo, multiline: true, keyboardType: 'default' as const },
            location: { label: 'Location', value: location, placeholder: 'Enter your location', icon: 'location', color: colors.iconSharing, multiline: false, keyboardType: 'default' as const },
            links: { label: 'Links', value: links.join(', '), placeholder: 'Enter your links (comma separated)', icon: 'link', color: colors.iconPersonalInfo, multiline: false, keyboardType: 'url' as const }
        };

        const config = fieldConfig[type as keyof typeof fieldConfig];
        if (!config) return null;

        const tempValue = (() => {
            switch (type) {
                case 'displayName': return tempDisplayName;
                case 'username': return tempUsername;
                case 'email': return tempEmail;
                case 'bio': return tempBio;
                case 'location': return tempLocation;
                case 'links': return tempLinks.join(', ');
                default: return '';
            }
        })();

        const setTempValue = (text: string) => {
            switch (type) {
                case 'displayName': setTempDisplayName(text); break;
                case 'username': setTempUsername(text); break;
                case 'email': setTempEmail(text); break;
                case 'bio': setTempBio(text); break;
                case 'location': setTempLocation(text); break;
                case 'links': setTempLinks(text.split(',').map(s => s.trim()).filter(Boolean)); break;
            }
        };

        return (
            <View style={[styles.editingFieldContainer, { backgroundColor: colors.background }]}>
                <View style={styles.editingFieldContent}>
                    <View style={styles.newValueSection}>
                        <View style={styles.editingFieldHeader}>
                            <Text style={[styles.editingFieldLabel, { color: colors.text }]}>
                                {config.label}
                            </Text>
                        </View>
                        <TextInput
                            style={[
                                config.multiline ? styles.editingFieldTextArea : styles.editingFieldInput,
                                {
                                    backgroundColor: themeStyles.isDarkTheme ? '#1C1C1E' : '#F2F2F7',
                                    color: themeStyles.isDarkTheme ? '#FFFFFF' : '#000000',
                                    borderColor: themeStyles.isDarkTheme ? '#38383A' : '#E5E5EA',
                                }
                            ]}
                            value={tempValue}
                            onChangeText={setTempValue}
                            placeholder={config.placeholder}
                            placeholderTextColor={themeStyles.isDarkTheme ? '#636366' : '#8E8E93'}
                            multiline={config.multiline}
                            numberOfLines={config.multiline ? 6 : 1}
                            keyboardType={config.keyboardType}
                            autoFocus
                            selectionColor={themeStyles.primaryColor}
                        />
                    </View>
                </View>
            </View>
        );
    };



    if (isLoading || !isAuthenticated) {
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
            {/* Header */}
            {editingField ? (
                <View style={[styles.editingHeader, {
                    backgroundColor: colors.background,
                    borderBottomColor: colors.border
                }]}>
                    <View style={styles.editingHeaderContent}>
                        <TouchableOpacity
                            style={[styles.editingBackButton, {
                                backgroundColor: colors.card
                            }]}
                            onPress={cancelEditing}
                        >
                            <Ionicons name="chevron-back" size={20} color={colors.tint} />
                        </TouchableOpacity>
                        <View style={styles.editingTitleContainer}>
                        </View>
                        <TouchableOpacity
                            style={[
                                styles.editingSaveButton,
                                {
                                    opacity: isSaving ? 0.5 : 1,
                                    backgroundColor: colors.card
                                }
                            ]}
                            onPress={() => saveField(editingField)}
                            disabled={isSaving}
                        >
                            {isSaving ? (
                                <ActivityIndicator size="small" color={colors.tint} />
                            ) : (
                                <Text style={[styles.editingSaveButtonText, { color: colors.tint }]}>Save</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                    <View style={styles.editingHeaderBottom}>
                        <View style={[styles.editingIconContainer, {
                            backgroundColor: editingField === 'displayName' ? `${colors.sidebarIconPersonalInfo}20` :
                                editingField === 'username' ? `${colors.sidebarIconData}20` :
                                    editingField === 'email' ? `${colors.sidebarIconSecurity}20` :
                                        editingField === 'bio' ? `${colors.sidebarIconPersonalInfo}20` :
                                            editingField === 'location' ? `${colors.sidebarIconSharing}20` :
                                                editingField === 'links' ? `${colors.sidebarIconPersonalInfo}20` : `${colors.tint}20`
                        }]}>
                            <MaterialCommunityIcons
                                name={
                                    editingField === 'displayName' ? 'account-outline' as any :
                                        editingField === 'username' ? 'at' as any :
                                            editingField === 'email' ? 'email-outline' as any :
                                                editingField === 'bio' ? 'text-box-outline' as any :
                                                    editingField === 'location' ? 'map-marker-outline' as any :
                                                        editingField === 'links' ? 'link-variant' as any : 'account-outline' as any
                                }
                                size={28}
                                color={
                                    editingField === 'displayName' ? colors.sidebarIconPersonalInfo :
                                        editingField === 'username' ? colors.sidebarIconData :
                                            editingField === 'email' ? colors.sidebarIconSecurity :
                                                editingField === 'bio' ? colors.sidebarIconPersonalInfo :
                                                    editingField === 'location' ? colors.sidebarIconSharing :
                                                        editingField === 'links' ? colors.sidebarIconPersonalInfo : colors.tint
                                }
                            />
                        </View>
                        <Text style={[styles.editingBottomTitle, { color: colors.text }]}>
                            {editingField === 'displayName' ? (t('editProfile.items.displayName.title') || 'Display Name') :
                                editingField === 'username' ? (t('editProfile.items.username.title') || 'Username') :
                                    editingField === 'email' ? (t('editProfile.items.email.title') || 'Email') :
                                        editingField === 'bio' ? (t('editProfile.items.bio.title') || 'Bio') :
                                            editingField === 'location' ? (t('editProfile.items.locations.title') || 'Location') :
                                                editingField === 'links' ? (t('editProfile.items.links.title') || 'Links') : 'Field'}
                        </Text>
                    </View>
                </View>
            ) : null}

            <ScrollView
                ref={scrollViewRef}
                style={editingField ? styles.contentEditing : styles.content}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
            >
                {editingField ? (
                    // Show only the editing interface when editing
                    <View style={styles.editingOnlyContainer}>
                        {renderEditingField(editingField)}
                    </View>
                ) : (
                    // Show all settings when not editing
                    <>
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
                                setAvatarSectionY(y);
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
                                            onPress: () => navigate?.('Profile', { userId: user?.id }),
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
                    </>
                )}
            </ScrollView>

            {/* Modal Components */}
            <EditDisplayNameModal
                visible={showEditDisplayNameModal}
                onClose={() => setShowEditDisplayNameModal(false)}
                initialDisplayName={displayName}
                initialLastName={lastName}
                theme={normalizedTheme}
                onSave={handleModalSave}
            />
            <EditUsernameModal
                visible={showEditUsernameModal}
                onClose={() => setShowEditUsernameModal(false)}
                initialValue={username}
                theme={normalizedTheme}
                onSave={handleModalSave}
            />
            <EditEmailModal
                visible={showEditEmailModal}
                onClose={() => setShowEditEmailModal(false)}
                initialValue={email}
                theme={normalizedTheme}
                onSave={handleModalSave}
            />
            <EditBioModal
                visible={showEditBioModal}
                onClose={() => setShowEditBioModal(false)}
                initialValue={bio}
                theme={normalizedTheme}
                onSave={handleModalSave}
            />
            <EditLocationModal
                visible={showEditLocationModal}
                onClose={() => setShowEditLocationModal(false)}
                initialLocations={locations}
                theme={normalizedTheme}
                onSave={handleModalSave}
            />
            <EditLinksModal
                visible={showEditLinksModal}
                onClose={() => setShowEditLinksModal(false)}
                initialLinks={linksMetadata}
                theme={normalizedTheme}
                onSave={handleModalSave}
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
