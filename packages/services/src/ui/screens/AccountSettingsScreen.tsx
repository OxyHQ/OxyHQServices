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
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import Avatar from '../components/Avatar';
import OxyIcon from '../components/icon/OxyIcon';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { fontFamilies } from '../styles/fonts';
import { confirmAction } from '../utils/confirmAction';
import { useAuthStore } from '../stores/authStore';
import { Header } from '../components';

const AccountSettingsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
}) => {
    const { user, oxyServices, isLoading: authLoading, isAuthenticated } = useOxy();
    const updateUser = useAuthStore((state) => state.updateUser);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

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
    const [avatarUrl, setAvatarUrl] = useState('');

    // Editing states
    const [editingField, setEditingField] = useState<string | null>(null);

    // Temporary input states for inline editing
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
    const animateSaveButton = useCallback((toValue: number) => {
        Animated.spring(saveButtonScale, {
            toValue,
            useNativeDriver: Platform.OS !== 'web',
            tension: 150,
            friction: 8,
        }).start();
    }, [saveButtonScale]);

    // Load user data
    useEffect(() => {
        if (user) {
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
            setAvatarUrl(user.avatar?.url || '');
        }
    }, [user]);

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

            console.log('Saving updates:', updates);
            console.log('Links metadata being saved:', tempLinksWithMetadata);

            // Handle name field
            if (displayName || lastName) {
                updates.name = { first: displayName, last: lastName };
            }

            // Handle avatar
            if (avatarUrl !== user.avatar?.url) {
                updates.avatar = { url: avatarUrl };
            }

            await updateUser(updates, oxyServices);
            toast.success('Profile updated successfully');

            animateSaveButton(1); // Scale back to normal

            if (onClose) {
                onClose();
            } else if (goBack) {
                goBack();
            }
        } catch (error: any) {
            toast.error(error.message || 'Failed to update profile');
            animateSaveButton(1); // Scale back to normal on error
        } finally {
            setIsSaving(false);
        }
    };

    const handleAvatarUpdate = () => {
        // Always use confirmAction for both web and native
        confirmAction('Remove your profile picture?', () => {
            setAvatarUrl('');
            toast.success('Avatar removed');
        });
    };

    const startEditing = (type: string, currentValue: string) => {
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
        }
        setEditingField(type);
    };

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

        // Brief delay for animation, then reset and close editing
        setTimeout(() => {
            animateSaveButton(1);
            setEditingField(null);
        }, 150);
    };

    const cancelEditing = () => {
        setEditingField(null);
    };

    const getFieldLabel = (type: string) => {
        const labels = {
            displayName: 'Display Name',
            username: 'Username',
            email: 'Email',
            bio: 'Bio',
            location: 'Location',
            links: 'Links'
        };
        return labels[type as keyof typeof labels] || 'Field';
    };

    const getFieldIcon = (type: string) => {
        const icons = {
            displayName: { name: 'person', color: '#007AFF' },
            username: { name: 'at', color: '#5856D6' },
            email: { name: 'mail', color: '#FF9500' },
            bio: { name: 'document-text', color: '#34C759' },
            location: { name: 'location', color: '#FF3B30' },
            links: { name: 'link', color: '#32D74B' }
        };
        return icons[type as keyof typeof icons] || { name: 'person', color: '#007AFF' };
    };

    const fetchLinkMetadata = async (url: string) => {
        try {
            setIsFetchingMetadata(true);
            console.log('Fetching metadata for URL:', url);

            // Use the backend API to fetch metadata
            const metadata = await oxyServices.fetchLinkMetadata(url);
            console.log('Received metadata:', metadata);

            return {
                ...metadata,
                id: Date.now().toString()
            };
        } catch (error) {
            console.error('Error fetching metadata:', error);
            // Fallback to basic metadata
            return {
                url: url.startsWith('http') ? url : 'https://' + url,
                title: url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
                description: 'Link',
                image: undefined,
                id: Date.now().toString()
            };
        } finally {
            setIsFetchingMetadata(false);
        }
    };

    const searchLocations = async (query: string) => {
        if (!query.trim() || query.length < 3) {
            setLocationSearchResults([]);
            return;
        }

        try {
            setIsSearchingLocations(true);
            const response = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`
            );
            const data = await response.json();
            setLocationSearchResults(data);
        } catch (error) {
            console.error('Error searching locations:', error);
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
                lat: parseFloat(locationData.lat),
                lon: parseFloat(locationData.lon)
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
        console.log('Adding link:', url);

        const metadata = await fetchLinkMetadata(url);
        console.log('Final metadata for adding:', metadata);

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
        if (type === 'displayName') {
            return (
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={styles.editingFieldLabel}>Edit Display Name</Text>
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
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={styles.editingFieldLabel}>Manage Your Locations</Text>
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
                <View style={styles.editingFieldContainer}>
                    <View style={styles.editingFieldContent}>
                        <View style={styles.newValueSection}>
                            <View style={styles.editingFieldHeader}>
                                <Text style={styles.editingFieldLabel}>Manage Your Links</Text>
                            </View>

                            {/* Add new link section */}
                            {isAddingLink ? (
                                <View style={styles.addLinkSection}>
                                    <Text style={styles.addLinkLabel}>
                                        Add New Link
                                        {isFetchingMetadata && (
                                            <Text style={styles.fetchingText}> • Fetching metadata...</Text>
                                        )}
                                    </Text>
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
                                </View>
                            ) : (
                                <TouchableOpacity
                                    style={styles.addLinkTrigger}
                                    onPress={() => setIsAddingLink(true)}
                                >
                                    <OxyIcon name="add" size={20} color={themeStyles.primaryColor} />
                                    <Text style={styles.addLinkTriggerText}>Add a new link</Text>
                                </TouchableOpacity>
                            )}

                            {/* Existing links list */}
                            {tempLinksWithMetadata.length > 0 && (
                                <View style={styles.linksList}>
                                    <Text style={styles.linksListTitle}>Your Links ({tempLinksWithMetadata.length})</Text>
                                    {tempLinksWithMetadata.map((link, index) => (
                                        <View key={link.id} style={styles.linkItem}>
                                            <View style={styles.linkItemContent}>
                                                {link.image ? (
                                                    <Image source={{ uri: link.image }} style={styles.linkItemImage} />
                                                ) : (
                                                    <View style={styles.linkItemImage}>
                                                        <Text style={styles.linkItemImageText}>
                                                            {link.title?.charAt(0).toUpperCase() || link.url.charAt(0).toUpperCase()}
                                                        </Text>
                                                    </View>
                                                )}
                                                <View style={styles.linkItemDragHandle}>
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
                                                </View>
                                                <View style={styles.linkItemInfo}>
                                                    <Text style={styles.linkItemTitle} numberOfLines={1}>
                                                        {link.title || link.url}
                                                    </Text>
                                                    {link.description && link.description !== link.title && (
                                                        <Text style={styles.linkItemDescription} numberOfLines={1}>
                                                            {link.description}
                                                        </Text>
                                                    )}
                                                    <Text style={styles.linkItemUrl} numberOfLines={1}>
                                                        {link.url}
                                                    </Text>
                                                </View>
                                                <View style={styles.linkItemActions}>
                                                    <TouchableOpacity
                                                        style={styles.linkItemButton}
                                                        onPress={() => removeLink(link.id)}
                                                    >
                                                        <OxyIcon name="trash" size={14} color="#FF3B30" />
                                                    </TouchableOpacity>
                                                </View>
                                            </View>
                                            {index < tempLinksWithMetadata.length - 1 && (
                                                <View style={styles.linkItemDivider} />
                                            )}
                                        </View>
                                    ))}
                                    <View style={styles.reorderHint}>
                                        <Text style={styles.reorderHintText}>Use ↑↓ buttons to reorder your links</Text>
                                    </View>
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
            <View style={styles.editingFieldContainer}>
                <View style={styles.editingFieldContent}>
                    <View style={styles.newValueSection}>
                        <View style={styles.editingFieldHeader}>
                            <Text style={styles.editingFieldLabel}>
                                {`Enter ${config.label.toLowerCase()}:`}
                            </Text>
                        </View>
                        <TextInput
                            style={[
                                config.multiline ? styles.editingFieldTextArea : styles.editingFieldInput,
                                {
                                    backgroundColor: themeStyles.isDarkTheme ? '#333' : '#fff',
                                    color: themeStyles.isDarkTheme ? '#fff' : '#000',
                                    borderColor: themeStyles.primaryColor
                                }
                            ]}
                            value={tempValue}
                            onChangeText={setTempValue}
                            placeholder={config.placeholder}
                            placeholderTextColor={themeStyles.isDarkTheme ? '#aaa' : '#999'}
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

    const renderField = (
        type: string,
        label: string,
        value: string,
        placeholder: string,
        icon: string,
        iconColor: string,
        multiline = false,
        keyboardType: 'default' | 'email-address' | 'url' = 'default',
        isFirst = false,
        isLast = false
    ) => {
        const itemStyles = [
            styles.settingItem,
            isFirst && styles.firstSettingItem,
            isLast && styles.lastSettingItem
        ];

        return (
            <TouchableOpacity
                style={itemStyles}
                onPress={() => startEditing(type, value)}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name={icon} size={20} color={iconColor} style={styles.settingIcon} />
                    <View>
                        <Text style={styles.settingLabel}>{label}</Text>
                        <Text style={styles.settingDescription}>
                            {value || placeholder}
                        </Text>
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>
        );
    };

    const renderLocationsField = (isFirst = false, isLast = false) => {
        const itemStyles = [
            styles.settingItem,
            isFirst && styles.firstSettingItem,
            isLast && styles.lastSettingItem
        ];

        const hasLocations = tempLocations.length > 0;

        return (
            <TouchableOpacity
                style={itemStyles}
                onPress={() => startEditing('location', '')}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="location" size={20} color="#FF3B30" style={styles.settingIcon} />
                    <View style={styles.linksFieldContent}>
                        <Text style={styles.settingLabel}>Locations</Text>
                        {hasLocations ? (
                            <View style={styles.linksPreview}>
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
                        ) : (
                            <Text style={styles.settingDescription}>Add your locations</Text>
                        )}
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>
        );
    };

    const renderLinksField = (isFirst = false, isLast = false) => {
        const itemStyles = [
            styles.settingItem,
            isFirst && styles.firstSettingItem,
            isLast && styles.lastSettingItem
        ];

        const hasLinks = tempLinksWithMetadata.length > 0;

        return (
            <TouchableOpacity
                style={itemStyles}
                onPress={() => startEditing('links', '')}
            >
                <View style={styles.settingInfo}>
                    <OxyIcon name="link" size={20} color="#32D74B" style={styles.settingIcon} />
                    <View style={styles.linksFieldContent}>
                        <Text style={styles.settingLabel}>Links</Text>
                        {hasLinks ? (
                            <View style={styles.linksPreview}>
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
                        ) : (
                            <Text style={styles.settingDescription}>Add your links</Text>
                        )}
                    </View>
                </View>
                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
            </TouchableOpacity>
        );
    };

    if (authLoading || !isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={themeStyles.primaryColor} />
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            {/* Header */}
            {editingField ? (
                <View style={[styles.editingHeader, { backgroundColor: '#FFFFFF', borderBottomColor: themeStyles.isDarkTheme ? '#38383A' : '#E9ECEF' }]}>
                    <View style={styles.editingHeaderContent}>
                        <TouchableOpacity style={styles.editingBackButton} onPress={cancelEditing}>
                            <OxyIcon name="chevron-back" size={20} color={themeStyles.primaryColor} />
                        </TouchableOpacity>
                        <View style={styles.editingTitleContainer}>
                        </View>
                        <TouchableOpacity
                            style={[styles.editingSaveButton, { opacity: isSaving ? 0.5 : 1 }]}
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
                        <OxyIcon name={getFieldIcon(editingField).name} size={56} color={getFieldIcon(editingField).color} style={styles.editingBottomIcon} />
                        <Text style={[styles.editingBottomTitle, { color: themeStyles.isDarkTheme ? '#FFFFFF' : '#1A1A1A' }]}>
                            {getFieldLabel(editingField)}
                        </Text>
                    </View>
                </View>
            ) : (
                <Header
                    title="Edit Profile"
                    theme={theme}
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

            <ScrollView style={editingField ? styles.contentEditing : styles.content}>
                {editingField ? (
                    // Show only the editing interface when editing
                    <View style={styles.editingOnlyContainer}>
                        {renderEditingField(editingField)}
                    </View>
                ) : (
                    // Show all settings when not editing
                    <>
                        {/* Profile Picture Section */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Profile Picture</Text>

                            <TouchableOpacity
                                style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}
                                onPress={handleAvatarUpdate}
                            >
                                <View style={styles.userIcon}>
                                    <Avatar
                                        uri={avatarUrl}
                                        name={displayName || username}
                                        size={50}
                                        theme={theme}
                                    />
                                </View>
                                <View style={styles.settingInfo}>
                                    <View>
                                        <Text style={styles.settingLabel}>Profile Photo</Text>
                                        <Text style={styles.settingDescription}>
                                            {avatarUrl ? 'Tap to change your profile picture' : 'Tap to add a profile picture'}
                                        </Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>
                        </View>

                        {/* Basic Information */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Basic Information</Text>

                            {renderField(
                                'displayName',
                                'Display Name',
                                [displayName, lastName].filter(Boolean).join(' '), // Show full name
                                'Add your display name',
                                'person',
                                '#007AFF',
                                false,
                                'default',
                                true,
                                false
                            )}

                            {renderField(
                                'username',
                                'Username',
                                username,
                                'Choose a username',
                                'at',
                                '#5856D6',
                                false,
                                'default',
                                false,
                                false
                            )}

                            {renderField(
                                'email',
                                'Email',
                                email,
                                'Add your email address',
                                'mail',
                                '#FF9500',
                                false,
                                'email-address',
                                false,
                                true
                            )}
                        </View>

                        {/* About You */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>About You</Text>

                            {renderField(
                                'bio',
                                'Bio',
                                bio,
                                'Tell people about yourself',
                                'document-text',
                                '#34C759',
                                true,
                                'default',
                                true,
                                false
                            )}

                            {renderLocationsField(false, false)}

                            {renderLinksField(false, true)}
                        </View>

                        {/* Quick Actions */}
                        <View style={styles.section}>
                            <Text style={styles.sectionTitle}>Quick Actions</Text>

                            <TouchableOpacity
                                style={[styles.settingItem, styles.firstSettingItem]}
                                onPress={() => toast.info('Privacy settings coming soon!')}
                            >
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="shield-checkmark" size={20} color="#8E8E93" style={styles.settingIcon} />
                                    <View>
                                        <Text style={styles.settingLabel}>Privacy Settings</Text>
                                        <Text style={styles.settingDescription}>Control who can see your profile</Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={[styles.settingItem, styles.lastSettingItem]}
                                onPress={() => toast.info('Account verification coming soon!')}
                            >
                                <View style={styles.settingInfo}>
                                    <OxyIcon name="checkmark-circle" size={20} color="#30D158" style={styles.settingIcon} />
                                    <View>
                                        <Text style={styles.settingLabel}>Verify Account</Text>
                                        <Text style={styles.settingDescription}>Get a verified badge</Text>
                                    </View>
                                </View>
                                <OxyIcon name="chevron-forward" size={16} color="#ccc" />
                            </TouchableOpacity>
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
        backgroundColor: '#f2f2f2',
    },
    content: {
        flex: 1,
        padding: 16,
    },
    contentEditing: {
        flex: 1,
        padding: 0,
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    settingItem: {
        backgroundColor: '#fff',
        padding: 16,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 2,
    },
    firstSettingItem: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    lastSettingItem: {
        borderBottomLeftRadius: 24,
        borderBottomRightRadius: 24,
        marginBottom: 8,
    },
    settingInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
    },
    settingIcon: {
        marginRight: 12,
    },
    settingLabel: {
        fontSize: 16,
        fontWeight: '500',
        color: '#333',
        marginBottom: 2,
    },
    settingDescription: {
        fontSize: 14,
        color: '#666',
    },
    userIcon: {
        marginRight: 12,
    },
    // Inline editing styles
    editingContainer: {
        flex: 1,
    },
    editingActions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    editingButton: {
        padding: 8,
    },
    editingButtonText: {
        fontSize: 16,
        fontWeight: '500',
    },
    inlineInput: {
        backgroundColor: '#f8f8f8',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        minHeight: 44,
    },
    inlineTextArea: {
        backgroundColor: '#f8f8f8',
        borderWidth: 1,
        borderColor: '#e0e0e0',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        minHeight: 100,
        textAlignVertical: 'top',
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
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 12,
        fontFamily: fontFamilies.phuduSemiBold,
    },
    editingFieldInput: {
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#e0e0e0',
        borderRadius: 12,
        padding: 16,
        fontSize: 17,
        minHeight: 52,
        fontWeight: '400',
    },
    editingFieldTextArea: {
        backgroundColor: '#fff',
        borderWidth: 2,
        borderColor: '#e0e0e0',
        borderRadius: 12,
        padding: 16,
        fontSize: 17,
        minHeight: 120,
        textAlignVertical: 'top',
        fontWeight: '400',
    },
    // Custom editing header styles
    editingHeader: {
        paddingTop: Platform.OS === 'ios' ? 50 : 16,
        paddingBottom: 0,
        borderBottomWidth: 1,
        backgroundColor: '#fff',
    },
    editingHeaderContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        minHeight: 44,
    },
    editingBackButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#F8F9FA',
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
        borderRadius: 18,
        backgroundColor: '#F8F9FA',
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
        paddingHorizontal: 16,
        paddingBottom: 8,
        paddingTop: 8,
    },
    editingBottomIcon: {
        marginBottom: 8,
        alignSelf: 'flex-start',
    },
    editingBottomTitle: {
        fontSize: 32,
        fontWeight: '700',
        fontFamily: fontFamilies.phuduBold,
        letterSpacing: -0.5,
        lineHeight: 36,
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
