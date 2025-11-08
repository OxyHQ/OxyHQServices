import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning' | 'ghost';
type ButtonSize = 'small' | 'medium' | 'large';

interface ButtonProps {
    title: string;
    onPress: () => void;
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    icon?: keyof typeof Ionicons.glyphMap;
    iconPosition?: 'left' | 'right';
    fullWidth?: boolean;
    style?: any;
}

export function Button({
    title,
    onPress,
    variant = 'primary',
    size = 'medium',
    disabled = false,
    loading = false,
    icon,
    iconPosition = 'left',
    fullWidth = false,
    style,
}: ButtonProps) {
    const buttonStyle = [
        styles.base,
        styles[variant],
        styles[`${size}Button`],
        fullWidth && styles.fullWidth,
        (disabled || loading) && styles.disabled,
        style,
    ];

    const textStyle = [
        styles.baseText,
        styles[`${variant}Text`],
        styles[`${size}Text`],
        (disabled || loading) && styles.disabledText,
    ];

    const iconColor = getIconColor(variant, disabled || loading);
    const iconSize = getIconSize(size);

    return (
        <TouchableOpacity
            style={buttonStyle}
            onPress={onPress}
            disabled={disabled || loading}
            activeOpacity={0.7}
        >
            {loading ? (
                <ActivityIndicator color={iconColor} size="small" />
            ) : (
                <View style={styles.content}>
                    {icon && iconPosition === 'left' && (
                        <Ionicons name={icon} size={iconSize} color={iconColor} style={styles.iconLeft} />
                    )}
                    <Text style={textStyle}>{title}</Text>
                    {icon && iconPosition === 'right' && (
                        <Ionicons name={icon} size={iconSize} color={iconColor} style={styles.iconRight} />
                    )}
                </View>
            )}
        </TouchableOpacity>
    );
}

function getIconColor(variant: ButtonVariant, disabled: boolean): string {
    if (disabled) return '#999999';
    
    switch (variant) {
        case 'primary':
        case 'danger':
        case 'warning':
            return '#FFFFFF';
        case 'secondary':
            return '#d169e5'; // Match services primary color
        case 'ghost':
            return '#d169e5'; // Match services primary color
        default:
            return '#FFFFFF';
    }
}

function getIconSize(size: ButtonSize): number {
    switch (size) {
        case 'small':
            return 16;
        case 'medium':
            return 20;
        case 'large':
            return 24;
        default:
            return 20;
    }
}

const styles = StyleSheet.create({
    base: {
        borderRadius: 35, // More rounded like services
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    content: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    fullWidth: {
        width: '100%',
    },
    disabled: {
        opacity: 0.5,
        shadowOpacity: 0,
        elevation: 0,
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
    warning: {
        backgroundColor: '#FF9500',
    },
    ghost: {
        backgroundColor: 'transparent',
        shadowOpacity: 0,
        elevation: 0,
    },

    // Sizes
    smallButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        height: 36,
    },
    mediumButton: {
        paddingVertical: 12,
        paddingHorizontal: 20,
        height: 48, // Match services button height
    },
    largeButton: {
        paddingVertical: 16,
        paddingHorizontal: 32,
        height: 56,
    },

    // Text styles
    baseText: {
        fontWeight: '600',
    },
    primaryText: {
        color: '#FFFFFF',
    },
    secondaryText: {
        color: '#d169e5', // Match services primary
    },
    dangerText: {
        color: '#FFFFFF',
    },
    warningText: {
        color: '#FFFFFF',
    },
    ghostText: {
        color: '#d169e5', // Match services primary
    },
    disabledText: {
        color: '#999999',
    },

    // Text sizes
    smallText: {
        fontSize: 14,
    },
    mediumText: {
        fontSize: 16,
    },
    largeText: {
        fontSize: 18,
    },

    // Icons
    iconLeft: {
        marginRight: 8,
    },
    iconRight: {
        marginLeft: 8,
    },
});
