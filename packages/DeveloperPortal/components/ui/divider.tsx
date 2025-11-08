import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface DividerProps {
    spacing?: 'small' | 'medium' | 'large';
    style?: any;
}

export function Divider({ spacing = 'medium', style }: DividerProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    return (
        <View style={[styles.container, styles[spacing], style]}>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
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
