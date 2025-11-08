import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface DividerProps {
    spacing?: 'small' | 'medium' | 'large';
    style?: any;
}

export function Divider({ spacing = 'medium', style }: DividerProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const isDark = colorScheme === 'dark';

    return (
        <View style={[styles.container, styles[spacing], style]}>
            <View style={[styles.line, { backgroundColor: isDark ? '#2C2C2E' : '#E5E5EA' }]} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
    },
    line: {
        height: 1,
    },
    small: {
        marginVertical: 8,
    },
    medium: {
        marginVertical: 16,
    },
    large: {
        marginVertical: 24,
    },
});
