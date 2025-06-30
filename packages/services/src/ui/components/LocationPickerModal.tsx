import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import UniversalMapView from './UniversalMapView';
import { Ionicons } from '@expo/vector-icons';

// Keep a local copy of the AddressObj type to avoid circular imports
export type AddressObj = {
    label?: string;
    formatted?: string;
    street?: string;
    number?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    lat?: number;
    lng?: number;
};

interface Props {
    visible: boolean;
    onCancel: () => void;
    onSave: (addr: AddressObj) => void;
    initialAddress?: AddressObj;
}

const LocationPickerModal: React.FC<Props> = ({ visible, onCancel, onSave, initialAddress }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<any | null>(null);
    const [label, setLabel] = useState<string>(initialAddress?.label || '');
    const [latitude, setLatitude] = useState<number | null>(null);
    const [longitude, setLongitude] = useState<number | null>(null);

    // Prefill when editing existing address
    useEffect(() => {
        if (visible && initialAddress) {
            setQuery(initialAddress.formatted || '');
            if (initialAddress.lat && initialAddress.lng) {
                setSelected({
                    display_name: initialAddress.formatted,
                    address: {
                        road: initialAddress.street,
                        city: initialAddress.city,
                        state: initialAddress.state,
                        postcode: initialAddress.postalCode,
                        country: initialAddress.country,
                    },
                    lat: initialAddress.lat,
                    lon: initialAddress.lng,
                });
            }
            setLabel(initialAddress.label || '');
        } else if (!visible) {
            // reset when closed
            setQuery('');
            setResults([]);
            setSelected(null);
            setLabel('');
        }
    }, [visible, initialAddress]);

    useEffect(() => {
        if (!query) {
            setResults([]);
            return;
        }
        const delay = setTimeout(() => {
            const fetchResults = async () => {
                setLoading(true);
                try {
                    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=5`;
                    const res = await fetch(url, { headers: { 'User-Agent': 'OxyHQApp/1.0' } });
                    const data = await res.json();
                    setResults(data || []);
                } catch (err) {
                    console.warn('Geocode error', err);
                } finally {
                    setLoading(false);
                }
            };
            fetchResults();
        }, 350);
        return () => clearTimeout(delay);
    }, [query]);

    useEffect(() => {
        if (latitude === null && longitude === null && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    setLatitude(position.coords.latitude);
                    setLongitude(position.coords.longitude);
                },
                (error) => {
                    console.error('Error getting location:', error);
                }
            );
        }
    }, [latitude, longitude]);

    const handleSelect = (item: any) => {
        setSelected(item);
        setResults([]); // hide list
        setQuery(item.display_name);
    };

    const handleSave = () => {
        if (!selected) return;
        const addr: AddressObj = {
            label: label.trim() || undefined,
            formatted: selected.display_name,
            street: selected.address?.road,
            city: selected.address?.city || selected.address?.town || selected.address?.village,
            state: selected.address?.state,
            postalCode: selected.address?.postcode,
            country: selected.address?.country,
            lat: Number(selected.lat),
            lng: Number(selected.lon)
        };
        onSave(addr);
    };

    return (
        <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
            <View style={styles.container}>
                <View style={styles.header}>
                    <TouchableOpacity onPress={onCancel} style={styles.headerButton}>
                        <Ionicons name="close" size={24} color="#666" />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Pick Location</Text>
                    <TouchableOpacity onPress={handleSave} disabled={!selected} style={styles.headerButton}>
                        <Ionicons name="checkmark" size={24} color={selected ? '#007AFF' : '#ccc'} />
                    </TouchableOpacity>
                </View>

                <TextInput
                    style={styles.searchInput}
                    placeholder="Search for a place..."
                    value={query}
                    onChangeText={setQuery}
                    autoFocus
                />
                {loading && <ActivityIndicator style={{ marginVertical: 8 }} />}
                {results.length > 0 && (
                    <FlatList
                        data={results}
                        keyExtractor={(item) => item.place_id.toString()}
                        renderItem={({ item }) => (
                            <TouchableOpacity onPress={() => handleSelect(item)} style={styles.resultItem}>
                                <Text style={styles.resultText}>{item.display_name}</Text>
                            </TouchableOpacity>
                        )}
                        style={{ maxHeight: 150 }}
                    />
                )}

                {/* Map */}
                <UniversalMapView
                    latitude={selected ? Number(selected.lat) : latitude}
                    longitude={selected ? Number(selected.lon) : longitude}
                    height={Platform.OS === 'web' ? 400 : 300}
                    onCoordinateChange={(lat: number, lon: number) => {
                        setSelected((prev: any) => prev ? { ...prev, lat, lon } : { display_name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, address: {}, lat, lon });
                    }}
                />

                {/* Label input */}
                <TextInput
                    placeholder="Label (e.g. Home, Work)"
                    value={label}
                    onChangeText={setLabel}
                    style={styles.labelInput}
                />
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#fff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e0e0e0',
    },
    headerButton: {
        padding: 4,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#000',
    },
    searchInput: {
        margin: 16,
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    resultItem: {
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    resultText: {
        color: '#333',
    },
    labelInput: {
        margin: 16,
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
});

export default LocationPickerModal; 