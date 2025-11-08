import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface CardProps {
    children: React.ReactNode;
    onPress?: () => void;
    style?: any;
    variant?: 'default' | 'outlined' | 'elevated';
}

export function Card({ children, onPress, style, variant = 'default' }: CardProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const cardStyle = [
        styles.base,
        variant === 'default' && {
            backgroundColor: colors.card,
            ...styles.elevated,
        },
        variant === 'outlined' && {
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
        },
        variant === 'elevated' && {
            backgroundColor: colors.card,
            ...styles.highElevation,
        },
        style,
    ];

    if (onPress) {
        return (
            <TouchableOpacity style={cardStyle} onPress={onPress} activeOpacity={0.7}>
                {children}
            </TouchableOpacity>
        );
    }

    return <View style={cardStyle}>{children}</View>;
}

const styles = StyleSheet.create({
    base: {
        borderRadius: 16,
        padding: 16,
    },
    elevated: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
    },
    highElevation: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
        elevation: 5,
    },
});
