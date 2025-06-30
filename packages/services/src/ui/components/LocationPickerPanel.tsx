import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import UniversalMapView from './UniversalMapView';
import { Ionicons } from '@expo/vector-icons';

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
    onCancel: () => void;
    onSave: (addr: AddressObj) => void;
    initialAddress?: AddressObj;
}

const LocationPickerPanel: React.FC<Props> = ({ onCancel, onSave, initialAddress }) => {
    const [query, setQuery] = useState(initialAddress?.formatted || '');
    const [results, setResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [selected, setSelected] = useState<any | null>(null);
    const [label, setLabel] = useState<string>(initialAddress?.label || '');

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
        if (initialAddress && !selected) {
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
        }
    }, [initialAddress]);

    const handleSelect = (item: any) => {
        setSelected(item);
        setResults([]);
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
        <View style={styles.card}>
            {/* Sticky header */}
            <View style={styles.actionsRow}>
                <TouchableOpacity onPress={onCancel} style={styles.headerIconBtn}>
                    <Ionicons name="arrow-back" size={22} color="#444" />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Pick Location</Text>
                <TouchableOpacity onPress={handleSave} disabled={!selected} style={styles.headerIconBtn}>
                    <Ionicons name="checkmark" size={22} color={selected ? '#007AFF' : '#ccc'} />
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

            <View style={styles.mapWrapper}>
                <UniversalMapView
                    latitude={selected ? Number(selected.lat) : null}
                    longitude={selected ? Number(selected.lon) : null}
                    height={Platform.OS === 'web' ? 380 : 280}
                    onCoordinateChange={(lat: number, lon: number) => {
                        setSelected((prev: any) => prev ? { ...prev, lat, lon } : { display_name: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, address: {}, lat, lon });
                    }}
                />
            </View>

            <TextInput
                placeholder="Label (e.g. Home, Work)"
                value={label}
                onChangeText={setLabel}
                style={styles.labelInput}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    card: {
        flex: 1,
        margin: 8,
        backgroundColor: '#fff',
        borderRadius: 16,
        overflow: 'hidden',
        ...Platform.select({
            android: { elevation: 4 },
            ios: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
            web: { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' } as any
        }),
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 6,
        backgroundColor: '#f9f9f9',
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#e0e0e0',
        ...Platform.select({
            web: { position: 'sticky', top: 0, zIndex: 2 } as any,
        }),
    },
    headerIconBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: { flex: 1, textAlign: 'center', fontWeight: '600', fontSize: 16 },
    searchInput: {
        margin: 12,
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
    resultText: { color: '#333' },
    labelInput: {
        margin: 16,
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
    },
    mapWrapper: {
        marginHorizontal: 12,
        borderRadius: 12,
        overflow: 'hidden',
    },
});

export default LocationPickerPanel; 