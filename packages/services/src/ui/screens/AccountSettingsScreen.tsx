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
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import type { FileMetadata } from '../../models/interfaces';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import { confirmAction } from '../utils/confirmAction';
import { useAuthStore } from '../stores/authStore';
import { Header, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import QRCode from 'react-native-qrcode-svg';
import { TTLCache, registerCacheForCleanup } from '../../utils/cache';

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
}) => {
    const { user: userFromContext, oxyServices, isLoading: authLoading, isAuthenticated, showBottomSheet, activeSessionId } = useOxy();
    const { t } = useI18n();
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

    // Two-Factor (TOTP) state
    const [totpSetupUrl, setTotpSetupUrl] = useState<string | null>(null);
    const [totpCode, setTotpCode] = useState('');
    const [isTotpBusy, setIsTotpBusy] = useState(false);
    const [showRecoveryModal, setShowRecoveryModal] = useState(false);
    const [generatedBackupCodes, setGeneratedBackupCodes] = useState<string[] | null>(null);
    const [generatedRecoveryKey, setGeneratedRecoveryKey] = useState<string | null>(null);

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

    // Editing states
    const [editingField, setEditingField] = useState<string | null>(null);

    const [tempDisplayName, setTempDisplayName] = useState('');
    const [tempLastName, setTempLastName] = useState('');
    const [tempUsername, setTempUsername] = useState('');
    const [tempEmail, setTempEmail] = useState('');
    const [tempBio, setTempBio] = useState('');
    const [tempLocation, setTempLocation] = useState('');
    const [tempLinks, setTempLinks] = useState<string[]>([]);
    const [tempLinksWithMetadata, setTempLinksWithMetadata] = useState<Array<{
        url: string;
        title?: string;
        description?: string;
        image?: string;
        id: string;
    }>>([]);
    const [isAddingLink, setIsAddingLink] = useState(false);
    const [newLinkUrl, setNewLinkUrl] = useState('');
    const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);

    // Location management state
    const [tempLocations, setTempLocations] = useState<Array<{
        id: string;
        name: string;
        label?: string;
        coordinates?: { lat: number; lon: number };
    }>>([]);
    const [isAddingLocation, setIsAddingLocation] = useState(false);
    const [newLocationQuery, setNewLocationQuery] = useState('');
    const [locationSearchResults, setLocationSearchResults] = useState<Array<{
        place_id: number;
        display_name: string;
        lat: string;
        lon: string;
        type: string;
    }>>([]);
    const [isSearchingLocations, setIsSearchingLocations] = useState(false);

    // Memoize theme-related calculations to prevent unnecessary recalculations
    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            isDarkTheme,
            backgroundColor: isDarkTheme ? '#121212' : '#f2f2f2',
            primaryColor: '#007AFF',
        };
    }, [theme]);

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
                    setTempLocations(user.locations.map((loc, index) => ({
                        id: loc.id || `existing-${index}`,
                        name: loc.name,
                        label: loc.label,
                        coordinates: loc.coordinates
                    })));
                } else if (user.location) {
                    // Convert single location string to array format
                    setTempLocations([{
                        id: 'existing-0',
                        name: user.location,
                        label: 'Location'
                    }]);
                } else {
                    setTempLocations([]);
                }

                // Handle links - simple and direct like other fields
                if (user.linksMetadata && Array.isArray(user.linksMetadata)) {
                    const urls = user.linksMetadata.map(l => l.url);
                    setLinks(urls);
                    const metadataWithIds = user.linksMetadata.map((link, index) => ({
                        ...link,
                        id: link.id || `existing-${index}`
                    }));
                    setTempLinksWithMetadata(metadataWithIds);
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
                    setTempLinksWithMetadata(linksWithMetadata);
                } else if (user.website) {
                    setLinks([user.website]);
                    setTempLinksWithMetadata([{
                        url: user.website,
                        title: user.website.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                        description: `Link to ${user.website}`,
                        image: undefined,
                        id: 'existing-0'
                    }]);
                } else {
                    setLinks([]);
                    setTempLinksWithMetadata([]);
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
    const initialFieldTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    
    // Delay constant for scroll completion
    const SCROLL_DELAY_MS = 600;
    
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
            case 'twoFactor':
                return '';
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
            
            if (sectionY !== null && sectionY !== undefined && scrollViewRef.current) {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        scrollViewRef.current?.scrollTo({
                            y: Math.max(0, sectionY - SCROLL_OFFSET),
                            animated: true,
                        });
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
                location: tempLocations.length > 0 ? tempLocations[0].name : '', // Keep backward compatibility
                locations: tempLocations.length > 0 ? tempLocations : undefined,
                links,
                linksMetadata: tempLinksWithMetadata.length > 0 ? tempLinksWithMetadata : undefined,
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
        showBottomSheet?.({
            screen: 'FileManagement',
            props: {
                selectMode: true,
                multiSelect: false,
                afterSelect: 'back',
                onSelect: async (file: FileMetadata) => {
                    if (!file.contentType.startsWith('image/')) {
                        toast.error(t('editProfile.toasts.selectImage') || 'Please select an image file');
                        return;
                    }
                    // If already selected, do nothing
                    if (file.id === avatarFileId) {
                        toast.info?.(t('editProfile.toasts.avatarUnchanged') || 'Avatar unchanged');
                        return;
                    }

                    // Optimistically update UI immediately
                    setOptimisticAvatarId(file.id);
                    setAvatarFileId(file.id);

                    // Auto-save avatar immediately (does not close edit profile screen)
                    (async () => {
                        try {
                            setIsUpdatingAvatar(true);

                            // Update file visibility to public for avatar
                            try {
                                await oxyServices.assetUpdateVisibility(file.id, 'public');
                            } catch (visError) {
                                // Continue with avatar update even if visibility update fails
                            }

                            // Update on server directly without using updateUser (which triggers fetchUser)
                            // This prevents the entire component from re-rendering
                            await oxyServices.updateProfile({ avatar: file.id });

                            // Update the user object in store directly without triggering fetchUser
                            // This prevents isLoading from being set to true, which would show loading screen
                            const currentUser = useAuthStore.getState().user;
                            if (currentUser) {
                                useAuthStore.setState({
                                    user: { ...currentUser, avatar: file.id },
                                    // Don't update lastUserFetch to avoid cache issues
                                });
                            }

                            // Update local state - keep avatarFileId set to the new value
                            // Don't clear optimisticAvatarId yet - let it persist until user object updates
                            // This ensures the avatar displays correctly
                            setAvatarFileId(file.id);

                            toast.success(t('editProfile.toasts.avatarUpdated') || 'Avatar updated');

                            // Scroll to avatar section after a brief delay to ensure UI is updated
                            requestAnimationFrame(() => {
                                requestAnimationFrame(() => {
                                    if (avatarSectionY !== null) {
                                        scrollViewRef.current?.scrollTo({
                                            y: Math.max(0, avatarSectionY - 100), // Offset to show section near top
                                            animated: true,
                                        });
                                    } else {
                                        // Fallback: scroll to approximate position
                                        scrollViewRef.current?.scrollTo({
                                            y: 200, // Approximate position of avatar section
                                            animated: true,
                                        });
                                    }
                                });
                            });
                        } catch (e: any) {
                            // Revert optimistic update on error
                            setAvatarFileId(typeof user?.avatar === 'string' ? user.avatar : '');
                            setOptimisticAvatarId(null);
                            toast.error(e.message || t('editProfile.toasts.updateAvatarFailed') || 'Failed to update avatar');
                        } finally {
                            setIsUpdatingAvatar(false);
                        }
                    })();
                },
                // Limit to images client-side by using photos view if later exposed
                disabledMimeTypes: ['video/', 'audio/', 'application/pdf']
            }
        });
    }, [showBottomSheet, oxyServices, avatarFileId, updateUser, user]);

    const startEditing = useCallback((type: string, currentValue: string) => {
        switch (type) {
            case 'displayName':
                setTempDisplayName(displayName);
                setTempLastName(lastName);
                break;
            case 'username':
                setTempUsername(currentValue);
                break;
            case 'email':
                setTempEmail(currentValue);
                break;
            case 'bio':
                setTempBio(currentValue);
                break;
            case 'location':
                // Don't reset the locations - keep the existing data
                break;
            case 'links':
                // Don't reset the metadata - keep the existing rich metadata
                // The tempLinksWithMetadata should already contain the rich data from the database
                break;
            case 'twoFactor':
                // Reset TOTP temp state
                setTotpSetupUrl(null);
                setTotpCode('');
                break;
        }
        setEditingField(type);
    }, [displayName, lastName]);

    // Handle initialField prop - must be after startEditing and openAvatarPicker are declared
    useEffect(() => {
        // Clear any pending timeout
        if (initialFieldTimeoutRef.current) {
            clearTimeout(initialFieldTimeoutRef.current);
            initialFieldTimeoutRef.current = null;
        }
        
        // If initialField changed, reset the flag
        if (previousInitialFieldRef.current !== initialField) {
            hasSetInitialFieldRef.current = false;
            previousInitialFieldRef.current = initialField;
        }
        
        // Set the editing field if initialField is provided and we haven't set it yet
        if (initialField && !hasSetInitialFieldRef.current) {
            // Special handling for avatar - open avatar picker directly
            if (initialField === 'avatar') {
                // Wait for section to be scrolled, then open picker
                initialFieldTimeoutRef.current = setTimeout(() => {
                    openAvatarPicker();
                    hasSetInitialFieldRef.current = true;
                }, SCROLL_DELAY_MS);
            } else {
                // For other fields, get current value and start editing after scroll
                const currentValue = getFieldCurrentValue(initialField);
                
                // Wait for section to be scrolled, then start editing
                initialFieldTimeoutRef.current = setTimeout(() => {
                    startEditing(initialField, currentValue);
                    hasSetInitialFieldRef.current = true;
                }, SCROLL_DELAY_MS);
            }
        }
        
        return () => {
            if (initialFieldTimeoutRef.current) {
                clearTimeout(initialFieldTimeoutRef.current);
                initialFieldTimeoutRef.current = null;
            }
        };
    }, [initialField, getFieldCurrentValue, startEditing, openAvatarPicker]);

    const saveField = (type: string) => {
        animateSaveButton(0.95); // Scale down slightly for animation

        switch (type) {
            case 'displayName':
                setDisplayName(tempDisplayName);
                setLastName(tempLastName);
                break;
            case 'username':
                setUsername(tempUsername);
                break;
            case 'email':
                setEmail(tempEmail);
                break;
            case 'bio':
                setBio(tempBio);
                break;
            case 'location':
                // Locations are handled in the main save function
                break;
            case 'links':
                // Save both URLs and metadata
                setLinks(tempLinksWithMetadata.map(link => link.url));
                // Store full metadata for database
                setTempLinksWithMetadata(tempLinksWithMetadata);
                break;
        }

        // Complete animation, then reset and close editing
        animateSaveButton(1, () => {
            setEditingField(null);
        });
    };

    const cancelEditing = () => {
        setEditingField(null);
    };



    const fetchLinkMetadata = async (url: string) => {
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
        const metadata = await fetchLinkMetadata(url);

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

    const renderEditingField = (type: string) => {
        if (type === 'twoFactor') {
            const enabled = !!user?.privacySettings?.twoFactorEnabled;
            return (
                <View style={[styles.editingFieldContainer, { backgroundColor: themeStyles.backgroundColor }]}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={[styles.editingFieldLabel, { color: themeStyles.isDarkTheme ? '#FFFFFF' : '#1A1A1A' }]}>Two‑Factor Authentication (TOTP)</Text>
                            </View>

                            {!enabled ? (
                                <>
                                    <Text style={styles.editingFieldDescription}>
                                        Protect your account with a 6‑digit code from an authenticator app. Scan the QR code then enter the code to enable.
                                    </Text>
                                    {!totpSetupUrl ? (
                                        <TouchableOpacity
                                            style={styles.primaryButton}
                                            disabled={isTotpBusy}
                                            onPress={async () => {
                                                if (!activeSessionId) { toast.error(t('editProfile.toasts.noActiveSession') || 'No active session'); return; }
                                                setIsTotpBusy(true);
                                                try {
                                                    const { otpauthUrl } = await oxyServices.startTotpEnrollment(activeSessionId);
                                                    setTotpSetupUrl(otpauthUrl);
                                                } catch (e: any) {
                                                    toast.error(e?.message || (t('editProfile.toasts.totpStartFailed') || 'Failed to start TOTP enrollment'));
                                                } finally {
                                                    setIsTotpBusy(false);
                                                }
                                            }}
                                        >
                                            <Ionicons name="shield-checkmark" size={18} color="#fff" />
                                            <Text style={styles.primaryButtonText}>Generate QR Code</Text>
                                        </TouchableOpacity>
                                    ) : (
                                        <View style={{ alignItems: 'center', gap: 16 }}>
                                            <View style={{ padding: 16, backgroundColor: '#fff', borderRadius: 16 }}>
                                                <QRCode value={totpSetupUrl} size={180} />
                                            </View>
                                            <View>
                                                <Text style={styles.editingFieldLabel}>Enter 6‑digit code</Text>
                                                <TextInput
                                                    style={styles.editingFieldInput}
                                                    keyboardType="number-pad"
                                                    placeholder="123456"
                                                    value={totpCode}
                                                    onChangeText={setTotpCode}
                                                    maxLength={6}
                                                />
                                            </View>
                                            <TouchableOpacity
                                                style={styles.primaryButton}
                                                disabled={isTotpBusy || totpCode.length !== 6}
                                                onPress={async () => {
                                                    if (!activeSessionId) { toast.error(t('editProfile.toasts.noActiveSession') || 'No active session'); return; }
                                                    setIsTotpBusy(true);
                                                    try {
                                                        const result = await oxyServices.verifyTotpEnrollment(activeSessionId, totpCode);
                                                        await updateUser({ privacySettings: { twoFactorEnabled: true } }, oxyServices);
                                                        if (result?.backupCodes || result?.recoveryKey) {
                                                            setGeneratedBackupCodes(result.backupCodes || null);
                                                            setGeneratedRecoveryKey(result.recoveryKey || null);
                                                            setShowRecoveryModal(true);
                                                        } else {
                                                            toast.success(t('editProfile.toasts.twoFactorEnabled') || 'Two‑Factor Authentication enabled');
                                                            setEditingField(null);
                                                        }
                                                    } catch (e: any) {
                                                        toast.error(e?.message || (t('editProfile.toasts.invalidCode') || 'Invalid code'));
                                                    } finally {
                                                        setIsTotpBusy(false);
                                                    }
                                                }}
                                            >
                                                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                                                <Text style={styles.primaryButtonText}>Verify & Enable</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}
                                </>
                            ) : (
                                <>
                                    <Text style={styles.editingFieldDescription}>
                                        Two‑Factor Authentication is currently enabled. To disable, enter a code from your authenticator app.
                                    </Text>
                                    <View>
                                        <Text style={styles.editingFieldLabel}>Enter 6‑digit code</Text>
                                        <TextInput
                                            style={styles.editingFieldInput}
                                            keyboardType="number-pad"
                                            placeholder="123456"
                                            value={totpCode}
                                            onChangeText={setTotpCode}
                                            maxLength={6}
                                        />
                                    </View>
                                    <TouchableOpacity
                                        style={[styles.primaryButton, { backgroundColor: '#d9534f' }]}
                                        disabled={isTotpBusy || totpCode.length !== 6}
                                        onPress={async () => {
                                            if (!activeSessionId) { toast.error(t('editProfile.toasts.noActiveSession') || 'No active session'); return; }
                                            setIsTotpBusy(true);
                                            try {
                                                await oxyServices.disableTotp(activeSessionId, totpCode);
                                                await updateUser({ privacySettings: { twoFactorEnabled: false } }, oxyServices);
                                                toast.success(t('editProfile.toasts.twoFactorDisabled') || 'Two‑Factor Authentication disabled');
                                                setEditingField(null);
                                            } catch (e: any) {
                                                toast.error(e?.message || t('editProfile.toasts.disableFailed') || 'Failed to disable');
                                            } finally {
                                                setIsTotpBusy(false);
                                            }
                                        }}
                                    >
                                        <Ionicons name="close-circle" size={18} color="#fff" />
                                        <Text style={styles.primaryButtonText}>Disable 2FA</Text>
                                    </TouchableOpacity>
                                </>
                            )}
                        </View>
                    </View>
                </View>
            );
        }
        if (type === 'displayName') {
            return (
                <View style={[styles.editingFieldContainer, { backgroundColor: themeStyles.backgroundColor }]}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={[styles.editingFieldLabel, { color: themeStyles.isDarkTheme ? '#FFFFFF' : '#1A1A1A' }]}>Edit Full Name</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 12 }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={styles.editingFieldLabel}>First Name</Text>
                                    <TextInput
                                        style={styles.editingFieldInput}
                                        value={tempDisplayName}
                                        onChangeText={setTempDisplayName}
                                        placeholder="Enter your first name"
                                        placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
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
                                        placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
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
                <View style={[styles.editingFieldContainer, { backgroundColor: themeStyles.backgroundColor }]}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={[styles.editingFieldLabel, { color: themeStyles.isDarkTheme ? '#FFFFFF' : '#1A1A1A' }]}>Manage Your Locations</Text>
                            </View>

                            {/* Add new location section */}
                            {isAddingLocation ? (
                                <View style={styles.addLocationSection}>
                                    <Text style={styles.addLocationLabel}>
                                        Add New Location
                                        {isSearchingLocations && (
                                            <Text style={styles.searchingText}> • Searching...</Text>
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
                                            placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
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
                                    <Text style={styles.addLocationTriggerText}>Add a new location</Text>
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
                                                            <View style={styles.locationLabel}>
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
                <View style={[styles.editingFieldContainer, { backgroundColor: themeStyles.backgroundColor }]}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={[styles.editingFieldLabel, { color: themeStyles.isDarkTheme ? '#FFFFFF' : '#1A1A1A' }]}>Manage Your Links</Text>
                            </View>

                            <GroupedSection
                                items={[
                                    // Add new link item
                                    ...(isAddingLink ? [{
                                        id: 'add-link-input',
                                        icon: 'add',
                                        iconColor: '#32D74B',
                                        title: 'Add New Link',
                                        subtitle: isFetchingMetadata ? 'Fetching metadata...' : 'Enter URL to add a new link',
                                        multiRow: true,
                                        customContent: (
                                            <View style={styles.addLinkInputContainer}>
                                                <TextInput
                                                    style={styles.addLinkInput}
                                                    value={newLinkUrl}
                                                    onChangeText={setNewLinkUrl}
                                                    placeholder="Enter URL (e.g., https://example.com)"
                                                    placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
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
                                                        style={[styles.addLinkButton, styles.addButton, { opacity: isFetchingMetadata ? 0.5 : 1 }]}
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
                                        icon: 'add',
                                        iconColor: '#32D74B',
                                        title: 'Add a new link',
                                        subtitle: 'Tap to add a new link to your profile',
                                        onPress: () => setIsAddingLink(true),
                                    }]),
                                    // Existing links
                                    ...tempLinksWithMetadata.map((link, index) => ({
                                        id: link.id,
                                        image: link.image || undefined,
                                        imageSize: 32,
                                        icon: link.image ? undefined : 'link',
                                        iconColor: '#32D74B',
                                        title: link.title || link.url,
                                        subtitle: link.description && link.description !== link.title ? link.description : link.url,
                                        multiRow: true,
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
            displayName: { label: 'Display Name', value: displayName, placeholder: 'Enter your display name', icon: 'person', color: '#007AFF', multiline: false, keyboardType: 'default' as const },
            username: { label: 'Username', value: username, placeholder: 'Choose a username', icon: 'at', color: '#5856D6', multiline: false, keyboardType: 'default' as const },
            email: { label: 'Email', value: email, placeholder: 'Enter your email address', icon: 'mail', color: '#FF9500', multiline: false, keyboardType: 'email-address' as const },
            bio: { label: 'Bio', value: bio, placeholder: 'Tell people about yourself...', icon: 'document-text', color: '#34C759', multiline: true, keyboardType: 'default' as const },
            location: { label: 'Location', value: location, placeholder: 'Enter your location', icon: 'location', color: '#FF3B30', multiline: false, keyboardType: 'default' as const },
            links: { label: 'Links', value: links.join(', '), placeholder: 'Enter your links (comma separated)', icon: 'link', color: '#32D74B', multiline: false, keyboardType: 'url' as const }
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
            <View style={[styles.editingFieldContainer, { backgroundColor: themeStyles.isDarkTheme ? '#000000' : '#FFFFFF' }]}>
                <View style={styles.editingFieldContent}>
                    <View style={styles.newValueSection}>
                        <View style={styles.editingFieldHeader}>
                            <Text style={[styles.editingFieldLabel, { color: themeStyles.isDarkTheme ? '#FFFFFF' : '#000000' }]}>
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



    if (authLoading || !isAuthenticated) {
        return (
            <View style={[styles.container, {
                backgroundColor: themeStyles.isDarkTheme ? '#000000' : '#F5F5F7',
                justifyContent: 'center'
            }]}>
                <ActivityIndicator size="large" color={themeStyles.primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.isDarkTheme ? '#000000' : '#F5F5F7' }]}>
            {/* Header */}
            {editingField ? (
                <View style={[styles.editingHeader, {
                    backgroundColor: themeStyles.isDarkTheme ? '#000000' : '#FFFFFF',
                    borderBottomColor: themeStyles.isDarkTheme ? '#38383A' : '#E5E5EA'
                }]}>
                    <View style={styles.editingHeaderContent}>
                        <TouchableOpacity
                            style={[styles.editingBackButton, {
                                backgroundColor: themeStyles.isDarkTheme ? '#1C1C1E' : '#F2F2F7'
                            }]}
                            onPress={cancelEditing}
                        >
                            <Ionicons name="chevron-back" size={20} color={themeStyles.primaryColor} />
                        </TouchableOpacity>
                        <View style={styles.editingTitleContainer}>
                        </View>
                        <TouchableOpacity
                            style={[
                                styles.editingSaveButton,
                                {
                                    opacity: isSaving ? 0.5 : 1,
                                    backgroundColor: themeStyles.isDarkTheme ? '#1C1C1E' : '#F2F2F7'
                                }
                            ]}
                            onPress={() => saveField(editingField)}
                            disabled={isSaving}
                        >
                            {isSaving ? (
                                <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                            ) : (
                                <Text style={[styles.editingSaveButtonText, { color: themeStyles.primaryColor }]}>Save</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                    <View style={styles.editingHeaderBottom}>
                        <View style={[styles.editingIconContainer, {
                            backgroundColor: editingField === 'displayName' ? '#007AFF20' :
                                editingField === 'username' ? '#5856D620' :
                                    editingField === 'email' ? '#FF950020' :
                                        editingField === 'bio' ? '#34C75920' :
                                            editingField === 'location' ? '#FF3B3020' :
                                                editingField === 'links' ? '#32D74B20' : '#007AFF20'
                        }]}>
                            <Ionicons
                                name={
                                    editingField === 'displayName' ? 'person' as any :
                                        editingField === 'username' ? 'at' as any :
                                            editingField === 'email' ? 'mail' as any :
                                                editingField === 'bio' ? 'document-text' as any :
                                                    editingField === 'location' ? 'location' as any :
                                                        editingField === 'links' ? 'link' as any : 'person' as any
                                }
                                size={28}
                                color={
                                    editingField === 'displayName' ? '#007AFF' :
                                        editingField === 'username' ? '#5856D6' :
                                            editingField === 'email' ? '#FF9500' :
                                                editingField === 'bio' ? '#34C759' :
                                                    editingField === 'location' ? '#FF3B30' :
                                                        editingField === 'links' ? '#32D74B' : '#007AFF'
                                }
                            />
                        </View>
                        <Text style={[styles.editingBottomTitle, { color: themeStyles.isDarkTheme ? '#FFFFFF' : '#000000' }]}>
                            {editingField === 'displayName' ? (t('editProfile.items.displayName.title') || 'Display Name') :
                                editingField === 'username' ? (t('editProfile.items.username.title') || 'Username') :
                                    editingField === 'email' ? (t('editProfile.items.email.title') || 'Email') :
                                        editingField === 'bio' ? (t('editProfile.items.bio.title') || 'Bio') :
                                            editingField === 'location' ? (t('editProfile.items.locations.title') || 'Location') :
                                                editingField === 'links' ? (t('editProfile.items.links.title') || 'Links') : 'Field'}
                        </Text>
                    </View>
                </View>
            ) : (
                <Header
                    title={t('editProfile.title') || 'Edit Profile'}
                    
                    onBack={goBack || onClose}
                    rightAction={{
                        icon: 'checkmark',
                        onPress: handleSave,
                        loading: isSaving,
                        disabled: isSaving,
                    }}
                    elevation="subtle"
                />
            )}

            <ScrollView
                ref={scrollViewRef}
                style={editingField ? styles.contentEditing : styles.content}
            >
                {editingField ? (
                    // Show only the editing interface when editing
                    <View style={styles.editingOnlyContainer}>
                        {renderEditingField(editingField)}
                    </View>
                ) : (
                    // Show all settings when not editing
                    <>
                        {showRecoveryModal && (
                            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 50, padding: 16, justifyContent: 'center' }}>
                                <View style={{ backgroundColor: '#fff', borderRadius: 20, padding: 20, maxHeight: '80%' }}>
                                    <Text style={{ fontSize: 18, fontWeight: '700', marginBottom: 12 }}>Save These Codes Now</Text>
                                    <Text style={{ fontSize: 14, color: '#444', marginBottom: 12 }}>
                                        Backup codes and your Recovery Key are shown only once. Store them securely (paper or password manager).
                                    </Text>
                                    {generatedBackupCodes && generatedBackupCodes.length > 0 && (
                                        <View style={{ marginBottom: 12 }}>
                                            <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>Backup Codes</Text>
                                            <View style={{ backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12 }}>
                                                {generatedBackupCodes.map((c, idx) => (
                                                    <Text key={idx} style={{ fontFamily: Platform.OS === 'web' ? 'monospace' as any : 'monospace', fontSize: 14, marginBottom: 4 }}>{c}</Text>
                                                ))}
                                            </View>
                                        </View>
                                    )}
                                    {generatedRecoveryKey && (
                                        <View style={{ marginBottom: 12 }}>
                                            <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>Recovery Key</Text>
                                            <View style={{ backgroundColor: '#F8F9FA', borderRadius: 12, padding: 12 }}>
                                                <Text style={{ fontFamily: Platform.OS === 'web' ? 'monospace' as any : 'monospace', fontSize: 14 }}>{generatedRecoveryKey}</Text>
                                            </View>
                                        </View>
                                    )}
                                    <TouchableOpacity
                                        style={[styles.primaryButton, { alignSelf: 'flex-end', marginTop: 8 }]}
                                        onPress={() => { setShowRecoveryModal(false); setEditingField(null); toast.success(t('editProfile.toasts.twoFactorEnabled') || 'Two‑Factor Authentication enabled'); }}
                                    >
                                        <Ionicons name="checkmark" size={18} color="#fff" />
                                        <Text style={styles.primaryButtonText}>I saved them</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
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
                            <Text style={[styles.sectionTitle, { color: themeStyles.isDarkTheme ? '#8E8E93' : '#8E8E93' }]}>
                                {t('editProfile.sections.profilePicture') || 'PROFILE PICTURE'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'profile-photo',
                                            icon: avatarFileId ? undefined : 'person',
                                            iconColor: '#007AFF',
                                            // Use optimistic avatar ID if available, otherwise use saved one
                                            image: (optimisticAvatarId || avatarFileId) ? oxyServices.getFileDownloadUrl(optimisticAvatarId || avatarFileId, 'thumb') : undefined,
                                            imageSize: 40,
                                            title: 'Profile Photo',
                                            subtitle: isUpdatingAvatar
                                                ? 'Updating profile picture...'
                                                : (avatarFileId ? 'Tap to change your profile picture' : 'Tap to add a profile picture'),
                                            onPress: isUpdatingAvatar ? undefined : openAvatarPicker,
                                            disabled: isUpdatingAvatar,
                                            customIcon: isUpdatingAvatar ? (
                                                <Animated.View style={{ position: 'relative', width: 40, height: 40 }}>
                                                    {(optimisticAvatarId || avatarFileId) && (
                                                        <Animated.Image
                                                            source={{ uri: oxyServices.getFileDownloadUrl(optimisticAvatarId || avatarFileId, 'thumb') }}
                                                            style={{
                                                                width: 40,
                                                                height: 40,
                                                                borderRadius: 22,
                                                                opacity: 0.6
                                                            }}
                                                        />
                                                    )}
                                                    <View style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        left: 0,
                                                        right: 0,
                                                        bottom: 0,
                                                        justifyContent: 'center',
                                                        alignItems: 'center',
                                                        backgroundColor: themeStyles.isDarkTheme ? 'rgba(0, 0, 0, 0.4)' : 'rgba(255, 255, 255, 0.7)',
                                                        borderRadius: 22,
                                                    }}>
                                                        <ActivityIndicator size="small" color={themeStyles.primaryColor} />
                                                    </View>
                                                </Animated.View>
                                            ) : undefined,
                                        },
                                        ...(avatarFileId && !isUpdatingAvatar ? [
                                            {
                                                id: 'remove-profile-photo',
                                                icon: 'trash',
                                                iconColor: '#FF3B30',
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
                            <Text style={[styles.sectionTitle, { color: themeStyles.isDarkTheme ? '#8E8E93' : '#8E8E93' }]}>
                                {t('editProfile.sections.basicInfo') || 'BASIC INFORMATION'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'display-name',
                                            icon: 'person',
                                            iconColor: '#007AFF',
                                            title: t('editProfile.items.displayName.title') || 'Display Name',
                                            subtitle: [displayName, lastName].filter(Boolean).join(' ') || (t('editProfile.items.displayName.add') || 'Add your display name'),
                                            onPress: () => startEditing('displayName', ''),
                                        },
                                        {
                                            id: 'username',
                                            icon: 'at',
                                            iconColor: '#5856D6',
                                            title: t('editProfile.items.username.title') || 'Username',
                                            subtitle: username || (t('editProfile.items.username.choose') || 'Choose a username'),
                                            onPress: () => startEditing('username', username),
                                        },
                                        {
                                            id: 'email',
                                            icon: 'mail',
                                            iconColor: '#FF9500',
                                            title: t('editProfile.items.email.title') || 'Email',
                                            subtitle: email || (t('editProfile.items.email.add') || 'Add your email address'),
                                            onPress: () => startEditing('email', email),
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
                            <Text style={[styles.sectionTitle, { color: themeStyles.isDarkTheme ? '#8E8E93' : '#8E8E93' }]}>
                                {t('editProfile.sections.about') || 'ABOUT YOU'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'bio',
                                            icon: 'document-text',
                                            iconColor: '#34C759',
                                            title: t('editProfile.items.bio.title') || 'Bio',
                                            subtitle: bio || (t('editProfile.items.bio.placeholder') || 'Tell people about yourself'),
                                            onPress: () => startEditing('bio', bio),
                                        },
                                        {
                                            id: 'locations',
                                            icon: 'location',
                                            iconColor: '#FF3B30',
                                            title: t('editProfile.items.locations.title') || 'Locations',
                                            subtitle: tempLocations.length > 0
                                                ? (tempLocations.length === 1
                                                    ? (t('editProfile.items.locations.count', { count: tempLocations.length }) || `${tempLocations.length} location added`)
                                                    : (t('editProfile.items.locations.count_plural', { count: tempLocations.length }) || `${tempLocations.length} locations added`))
                                                : (t('editProfile.items.locations.add') || 'Add your locations'),
                                            onPress: () => startEditing('location', ''),
                                            customContentBelow: tempLocations.length > 0 && (
                                                <View style={styles.linksPreviewContainer}>
                                                    {tempLocations.slice(0, 2).map((location, index) => (
                                                        <View key={location.id || index} style={styles.linkPreviewItem}>
                                                            <View style={styles.linkPreviewImage}>
                                                                <Text style={styles.linkPreviewImageText}>
                                                                    {location.name.charAt(0).toUpperCase()}
                                                                </Text>
                                                            </View>
                                                            <View style={styles.linkPreviewContent}>
                                                                <Text style={styles.linkPreviewTitle} numberOfLines={1}>
                                                                    {location.name}
                                                                </Text>
                                                                {location.label && (
                                                                    <Text style={styles.linkPreviewSubtitle}>
                                                                        {location.label}
                                                                    </Text>
                                                                )}
                                                            </View>
                                                        </View>
                                                    ))}
                                                    {tempLocations.length > 2 && (
                                                        <Text style={styles.linkPreviewMore}>
                                                            +{tempLocations.length - 2} more
                                                        </Text>
                                                    )}
                                                </View>
                                            ),
                                        },
                                        {
                                            id: 'links',
                                            icon: 'link',
                                            iconColor: '#32D74B',
                                            title: t('editProfile.items.links.title') || 'Links',
                                            subtitle: tempLinksWithMetadata.length > 0
                                                ? (tempLinksWithMetadata.length === 1
                                                    ? (t('editProfile.items.links.count', { count: tempLinksWithMetadata.length }) || `${tempLinksWithMetadata.length} link added`)
                                                    : (t('editProfile.items.links.count_plural', { count: tempLinksWithMetadata.length }) || `${tempLinksWithMetadata.length} links added`))
                                                : (t('editProfile.items.links.add') || 'Add your links'),
                                            onPress: () => startEditing('links', ''),
                                            multiRow: true,
                                            customContentBelow: tempLinksWithMetadata.length > 0 && (
                                                <View style={styles.linksPreviewContainer}>
                                                    {tempLinksWithMetadata.slice(0, 2).map((link, index) => (
                                                        <View key={link.id || index} style={styles.linkPreviewItem}>
                                                            {link.image ? (
                                                                <Image source={{ uri: link.image }} style={styles.linkPreviewImage} />
                                                            ) : (
                                                                <View style={styles.linkPreviewImage}>
                                                                    <Text style={styles.linkPreviewImageText}>
                                                                        {link.title?.charAt(0).toUpperCase() || link.url.charAt(0).toUpperCase()}
                                                                    </Text>
                                                                </View>
                                                            )}
                                                            <Text style={styles.linkPreviewTitle} numberOfLines={1}>
                                                                {link.title || link.url}
                                                            </Text>
                                                        </View>
                                                    ))}
                                                    {tempLinksWithMetadata.length > 2 && (
                                                        <Text style={styles.linkPreviewMore}>
                                                            +{tempLinksWithMetadata.length - 2} more
                                                        </Text>
                                                    )}
                                                </View>
                                            ),
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
                            <Text style={[styles.sectionTitle, { color: themeStyles.isDarkTheme ? '#8E8E93' : '#8E8E93' }]}>
                                {t('editProfile.sections.quickActions') || 'QUICK ACTIONS'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'preview-profile',
                                            icon: 'eye',
                                            iconColor: '#007AFF',
                                            title: t('editProfile.items.previewProfile.title') || 'Preview Profile',
                                            subtitle: t('editProfile.items.previewProfile.subtitle') || 'See how your profile looks to others',
                                            onPress: () => navigate?.('Profile', { userId: user?.id }),
                                        },
                                        {
                                            id: 'privacy-settings',
                                            icon: 'shield-checkmark',
                                            iconColor: '#8E8E93',
                                            title: t('editProfile.items.privacySettings.title') || 'Privacy Settings',
                                            subtitle: t('editProfile.items.privacySettings.subtitle') || 'Control who can see your profile',
                                            onPress: () => navigate?.('PrivacySettings'),
                                        },
                                        {
                                            id: 'verify-account',
                                            icon: 'checkmark-circle',
                                            iconColor: '#30D158',
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
                            <Text style={[styles.sectionTitle, { color: themeStyles.isDarkTheme ? '#8E8E93' : '#8E8E93' }]}>
                                {t('editProfile.sections.security') || 'SECURITY'}
                            </Text>
                            <View style={styles.groupedSectionWrapper}>
                                <GroupedSection
                                    items={[
                                        {
                                            id: 'two-factor',
                                            icon: 'shield-checkmark',
                                            iconColor: '#007AFF',
                                            title: t('editProfile.items.twoFactor.title') || 'Two‑Factor Authentication',
                                            subtitle: user?.privacySettings?.twoFactorEnabled
                                                ? (t('editProfile.items.twoFactor.enabled') || 'Enabled')
                                                : (t('editProfile.items.twoFactor.disabled') || 'Disabled (recommended)'),
                                            onPress: () => startEditing('twoFactor', ''),
                                        },
                                    ]}
                                    
                                />
                            </View>
                        </View>
                    </>
                )}
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        paddingTop: 8,
        paddingBottom: 24,
    },
    contentEditing: {
        flex: 1,
        padding: 0,
    },
    section: {
        marginBottom: 32,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        color: '#8E8E93',
        marginBottom: 8,
        marginTop: 4,
        marginHorizontal: 16,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    groupedSectionWrapper: {
        marginHorizontal: 16,
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
        backgroundColor: '#007AFF',
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
        backgroundColor: '#007AFF',
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
        color: '#007AFF',
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
        backgroundColor: '#007AFF',
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
        color: '#007AFF',
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
        backgroundColor: '#007AFF',
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
        color: '#007AFF',
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
        color: '#007AFF',
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
        backgroundColor: '#007AFF',
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
