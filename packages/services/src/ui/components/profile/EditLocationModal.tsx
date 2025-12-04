import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Platform,
    ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { useI18n } from '../../hooks/useI18n';
import { fontFamilies } from '../../styles/fonts';
import { useProfileEditing } from '../../hooks/useProfileEditing';

interface Location {
    id: string;
    name: string;
    label?: string;
    coordinates?: { lat: number; lon: number };
}

interface EditLocationModalProps {
    visible: boolean;
    onClose: () => void;
    initialLocations?: Location[];
    theme?: 'light' | 'dark';
    onSave?: () => void;
}

export const EditLocationModal: React.FC<EditLocationModalProps> = ({
    visible,
    onClose,
    initialLocations = [],
    theme = 'light',
    onSave,
}) => {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    const colors = themeStyles.colors;
    const { saveProfile, isSaving } = useProfileEditing();

    const [locations, setLocations] = useState<Location[]>(initialLocations);
    const [newLocation, setNewLocation] = useState('');

    useEffect(() => {
        if (visible) {
            setLocations(initialLocations);
            setNewLocation('');
        }
    }, [visible, initialLocations]);

    const handleAddLocation = () => {
        if (!newLocation.trim()) return;
        const location: Location = {
            id: `location-${Date.now()}`,
            name: newLocation.trim(),
        };
        setLocations([...locations, location]);
        setNewLocation('');
    };

    const handleRemoveLocation = (id: string) => {
        setLocations(locations.filter(loc => loc.id !== id));
    };

    const handleSave = async () => {
        const success = await saveProfile({ locations });
        if (success) {
            onSave?.();
            onClose();
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>
                            {t('editProfile.items.locations.title') || 'Locations'}
                        </Text>
                        <TouchableOpacity
                            onPress={handleSave}
                            disabled={isSaving}
                            style={[styles.saveButton, { opacity: isSaving ? 0.5 : 1 }]}
                        >
                            <Text style={[styles.saveButtonText, { color: colors.tint }]}>
                                {isSaving ? 'Saving...' : 'Save'}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <ScrollView style={styles.modalBody}>
                        <View style={styles.inputGroup}>
                            <Text style={[styles.label, { color: colors.text }]}>
                                {t('editProfile.items.locations.add') || 'Add Location'}
                            </Text>
                            <View style={styles.addLocationRow}>
                                <TextInput
                                    style={[
                                        styles.input,
                                        {
                                            backgroundColor: colors.card,
                                            color: colors.text,
                                            borderColor: colors.border,
                                            flex: 1,
                                        },
                                    ]}
                                    value={newLocation}
                                    onChangeText={setNewLocation}
                                    placeholder={t('editProfile.items.locations.placeholder') || 'Enter location name'}
                                    placeholderTextColor={colors.secondaryText}
                                    selectionColor={colors.tint}
                                />
                                <TouchableOpacity
                                    style={[styles.addButton, { backgroundColor: colors.tint }]}
                                    onPress={handleAddLocation}
                                    disabled={!newLocation.trim()}
                                >
                                    <Ionicons name="add" size={20} color="#fff" />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {locations.length > 0 && (
                            <View style={styles.locationsList}>
                                <Text style={[styles.listTitle, { color: colors.text }]}>
                                    {t('editProfile.items.locations.yourLocations') || 'Your Locations'} ({locations.length})
                                </Text>
                                {locations.map((location, index) => (
                                    <View
                                        key={location.id}
                                        style={[
                                            styles.locationItem,
                                            { backgroundColor: colors.card, borderColor: colors.border },
                                            index < locations.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth },
                                        ]}
                                    >
                                        <Text style={[styles.locationName, { color: colors.text }]}>
                                            {location.name}
                                        </Text>
                                        <TouchableOpacity
                                            onPress={() => handleRemoveLocation(location.id)}
                                            style={styles.removeButton}
                                        >
                                            <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                                        </TouchableOpacity>
                                    </View>
                                ))}
                            </View>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: Platform.OS === 'ios' ? 20 : 16,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E5EA',
    },
    closeButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        flex: 1,
        textAlign: 'center',
    },
    saveButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
    },
    saveButtonText: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    modalBody: {
        padding: 16,
    },
    inputGroup: {
        gap: 8,
        marginBottom: 24,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    addLocationRow: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    input: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 52,
    },
    addButton: {
        width: 52,
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    locationsList: {
        gap: 8,
    },
    listTitle: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        marginBottom: 8,
    },
    locationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
    },
    locationName: {
        fontSize: 16,
        flex: 1,
    },
    removeButton: {
        padding: 8,
    },
});








