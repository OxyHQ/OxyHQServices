import React from 'react';
import MapView, { Marker, UrlTile, Region } from 'react-native-maps';
import { StyleSheet } from 'react-native';

interface Props {
    latitude: number | null;
    longitude: number | null;
    height: number;
    onCoordinateChange: (lat: number, lon: number) => void;
}

const UniversalMapView: React.FC<Props> = ({ latitude, longitude, height, onCoordinateChange }) => {
    const region: Region = latitude !== null && longitude !== null ? {
        latitude,
        longitude,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
    } : {
        latitude: 0,
        longitude: 0,
        latitudeDelta: 60,
        longitudeDelta: 60,
    };

    const handleRegionChangeComplete = (reg: Region) => {
        onCoordinateChange(reg.latitude, reg.longitude);
    };

    const handleMapPress = (e: any) => {
        const { latitude: lat, longitude: lon } = e.nativeEvent.coordinate;
        onCoordinateChange(lat, lon);
    };

    const handleMarkerDragEnd = (e: any) => {
        const { latitude: lat, longitude: lon } = e.nativeEvent.coordinate;
        onCoordinateChange(lat, lon);
    };

    return (
        <MapView
            style={[styles.map, { height }]}
            initialRegion={region}
            region={region}
            onRegionChangeComplete={handleRegionChangeComplete}
            onPress={handleMapPress}
            pitchEnabled={false}
            rotateEnabled={false}
            toolbarEnabled={false}
            zoomControlEnabled
        >
            <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} />
            {latitude !== null && longitude !== null && (
                <Marker coordinate={{ latitude, longitude }} draggable onDragEnd={handleMarkerDragEnd} />
            )}
        </MapView>
    );
};

const styles = StyleSheet.create({
    map: {
        width: '100%',
    },
});

export default UniversalMapView; 