import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface BadgeProps {
    label: string;
    variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
    size?: 'small' | 'medium' | 'large';
    style?: any;
}

export function Badge({ label, variant = 'primary', size = 'medium', style }: BadgeProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const isDark = colorScheme === 'dark';

    const badgeStyle = [
        styles.base,
        styles[size],
        styles[variant],
        style,
    ];

    const textStyle = [
        styles.text,
        styles[`${size}Text`],
        variant === 'neutral' && { color: isDark ? '#FFFFFF' : '#000000' },
    ];

    return (
        <View style={badgeStyle}>
            <ThemedText style={textStyle}>{label}</ThemedText>
        </View>
    );
}

const styles = StyleSheet.create({
    base: {
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        alignSelf: 'flex-start',
    },

    // Sizes
    small: {
        paddingHorizontal: 8,
        paddingVertical: 2,
    },
    medium: {
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    large: {
        paddingHorizontal: 12,
        paddingVertical: 6,
    },

    // Variants
    primary: {
        backgroundColor: '#d169e5', // Match services primary
    },
    success: {
        backgroundColor: '#34C759',
    },
    warning: {
        backgroundColor: '#FF9500',
    },
    danger: {
        backgroundColor: '#FF3B30',
    },
    info: {
        backgroundColor: '#5AC8FA',
    },
    neutral: {
        backgroundColor: '#8E8E93',
    },

    // Text styles
    text: {
        color: '#FFFFFF',
        fontWeight: '700',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    smallText: {
        fontSize: 10,
    },
    mediumText: {
        fontSize: 11,
    },
    largeText: {
        fontSize: 12,
    },
});
