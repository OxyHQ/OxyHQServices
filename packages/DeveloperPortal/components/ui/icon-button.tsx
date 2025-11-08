import React from 'react';
import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface IconButtonProps {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    size?: 'small' | 'medium' | 'large';
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    disabled?: boolean;
    style?: any;
}

export function IconButton({
    icon,
    onPress,
    size = 'medium',
    variant = 'primary',
    disabled = false,
    style,
}: IconButtonProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const buttonStyle = [
        styles.base,
        styles[size],
        styles[variant],
        disabled && styles.disabled,
        style,
    ];

    const iconSize = size === 'small' ? 18 : size === 'large' ? 28 : 24;
    const iconColor = getIconColor(variant, colors, disabled);

    return (
        <TouchableOpacity
            style={buttonStyle}
            onPress={onPress}
            disabled={disabled}
            activeOpacity={0.7}
        >
            <Ionicons name={icon} size={iconSize} color={iconColor} />
        </TouchableOpacity>
    );
}

function getIconColor(variant: string, colors: any, disabled: boolean): string {
    if (disabled) return '#999999';

    switch (variant) {
        case 'primary':
            return '#FFFFFF';
        case 'secondary':
            return colors.tint;
        case 'danger':
            return '#FFFFFF';
        case 'ghost':
            return colors.icon;
        default:
            return '#FFFFFF';
    }
}

const styles = StyleSheet.create({
    base: {
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    disabled: {
        opacity: 0.5,
    },

    // Sizes
    small: {
        width: 32,
        height: 32,
    },
    medium: {
        width: 40,
        height: 40,
    },
    large: {
        width: 48,
        height: 48,
    },

    // Variants
    primary: {
        backgroundColor: '#d169e5', // Match services primary
    },
    secondary: {
        backgroundColor: '#F2F2F7',
        borderWidth: 1,
        borderColor: '#d169e5', // Match services primary
    },
    danger: {
        backgroundColor: '#FF3B30',
    },
    ghost: {
        backgroundColor: 'transparent',
    },
});
