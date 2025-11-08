import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { ThemedText } from '../themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface LoadingProps {
    message?: string;
    size?: 'small' | 'large';
    fullScreen?: boolean;
}

export function Loading({ message, size = 'large', fullScreen = false }: LoadingProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const containerStyle = [
        styles.container,
        fullScreen && styles.fullScreen,
    ];

    return (
        <View style={containerStyle}>
            <ActivityIndicator size={size} color={colors.tint} />
            {message && (
                <ThemedText style={styles.message}>{message}</ThemedText>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    fullScreen: {
        flex: 1,
    },
    message: {
        marginTop: 12,
        fontSize: 14,
        opacity: 0.7,
    },
});
