'use client';

import React, { useEffect, useRef } from 'react';

interface Props {
    latitude: number | null;
    longitude: number | null;
    height: number;
    onCoordinateChange?: (lat: number, lon: number) => void;
}

/**
 * Lightweight web map based on Leaflet (loaded dynamically from CDN).
 * Supports click & drag events to pick coordinates. No API key required.
 */
const UniversalMapView: React.FC<Props> = ({ latitude, longitude, height, onCoordinateChange }) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMapRef = useRef<any>(null);
    const markerRef = useRef<any>(null);

    // Dynamically load Leaflet scripts/styles exactly once
    useEffect(() => {
        const loadLeaflet = async () => {
            if ((window as any)._leafletLoaded) return;
            return new Promise<void>((resolve) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
                document.head.appendChild(link);
                const script = document.createElement('script');
                script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
                script.onload = () => {
                    (window as any)._leafletLoaded = true;
                    resolve();
                };
                document.body.appendChild(script);
            });
        };
        loadLeaflet();
    }, []);

    // Initialise map after Leaflet is loaded
    useEffect(() => {
        const init = () => {
            if (!(window as any).L || !mapRef.current || leafletMapRef.current) return;
            const L = (window as any).L;
            const center = latitude !== null && longitude !== null ? [latitude, longitude] : [0, 0];
            const zoom = latitude !== null ? 14 : 2;
            const map = L.map(mapRef.current).setView(center, zoom);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap contributors'
            }).addTo(map);
            if (latitude !== null && longitude !== null) {
                markerRef.current = L.marker([latitude, longitude], { draggable: true }).addTo(map);
                markerRef.current.on('dragend', (e: any) => {
                    const { lat, lng } = e.target.getLatLng();
                    onCoordinateChange?.(lat, lng);
                });
            }
            map.on('click', (e: any) => {
                const { lat, lng } = e.latlng;
                if (markerRef.current) {
                    markerRef.current.setLatLng([lat, lng]);
                } else {
                    markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);
                    markerRef.current.on('dragend', (ev: any) => {
                        const { lat: dLat, lng: dLng } = ev.target.getLatLng();
                        onCoordinateChange?.(dLat, dLng);
                    });
                }
                onCoordinateChange?.(lat, lng);
            });
            leafletMapRef.current = map;
        };
        if ((window as any)._leafletLoaded) {
            init();
        } else {
            const interval = setInterval(() => {
                if ((window as any)._leafletLoaded) {
                    clearInterval(interval);
                    init();
                }
            }, 200);
            return () => clearInterval(interval);
        }
    }, [latitude, longitude, onCoordinateChange]);

    // Update marker if props change externally
    useEffect(() => {
        if (!leafletMapRef.current || !(window as any).L) return;
        const map = leafletMapRef.current;
        const L = (window as any).L;
        if (latitude !== null && longitude !== null) {
            const newLatLng = L.latLng(latitude, longitude);
            if (markerRef.current) {
                markerRef.current.setLatLng(newLatLng);
            } else {
                markerRef.current = L.marker(newLatLng, { draggable: true }).addTo(map);
                markerRef.current.on('dragend', (e: any) => {
                    const { lat, lng } = e.target.getLatLng();
                    onCoordinateChange?.(lat, lng);
                });
            }
            map.setView(newLatLng, 14);
        }
    }, [latitude, longitude]);

    return <div ref={mapRef} style={{ width: '100%', height }} />;
};

export default UniversalMapView; 