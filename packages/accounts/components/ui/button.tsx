import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonProps {
    children: React.ReactNode;
    onPress?: () => void;
    variant?: ButtonVariant;
    disabled?: boolean;
    loading?: boolean;
    style?: ViewStyle;
    textStyle?: TextStyle;
    testID?: string;
}

export function Button({
    children,
    onPress,
    variant = 'primary',
    disabled = false,
    loading = false,
    style,
    textStyle,
    testID,
}: ButtonProps) {
    const colors = useColors();
    const backgroundColor = colors.background;
    const textColor = colors.text;

    const isDisabled = disabled || loading;

    // Determine button styles based on variant
    const getButtonStyle = (): ViewStyle => {
        const baseStyle: ViewStyle = {
            paddingVertical: 10,
            paddingHorizontal: 16,
            borderRadius: 35,
            alignItems: 'center',
            justifyContent: 'center',
        };

        switch (variant) {
            case 'primary':
                return {
                    ...baseStyle,
                    backgroundColor: isDisabled
                        ? colors.card
                        : textColor,
                    opacity: isDisabled ? 0.6 : 1,
                };
            case 'secondary':
                return {
                    ...baseStyle,
                    backgroundColor: 'transparent',
                    borderWidth: 1,
                    borderColor: `${textColor}40`,
                };
            case 'ghost':
                return {
                    paddingVertical: 10,
                    paddingHorizontal: 16,
                    borderRadius: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'transparent',
                };
            default:
                return baseStyle;
        }
    };

    // Determine text styles based on variant
    const getTextStyle = (): TextStyle => {
        const baseStyle: TextStyle = {
            fontSize: 14,
            fontFamily: 'Inter-SemiBold',
            fontWeight: '600',
        };

        switch (variant) {
            case 'primary':
                return {
                    ...baseStyle,
                    color: isDisabled
                        ? colors.textSecondary
                        : backgroundColor,
                };
            case 'secondary':
                return {
                    ...baseStyle,
                    color: textColor,
                };
            case 'ghost':
                return {
                    ...baseStyle,
                    color: textColor,
                    opacity: 0.6,
                    textDecorationLine: 'underline',
                };
            default:
                return {
                    ...baseStyle,
                    color: textColor,
                };
        }
    };

    return (
        <TouchableOpacity
            style={[getButtonStyle(), style]}
            onPress={onPress}
            disabled={isDisabled}
            activeOpacity={0.8}
            testID={testID}
        >
            {loading ? (
                <ActivityIndicator
                    color={variant === 'primary' && !isDisabled ? backgroundColor : textColor}
                    size="small"
                />
            ) : (
                <Text style={[getTextStyle(), textStyle]}>{children}</Text>
            )}
        </TouchableOpacity>
    );
}

