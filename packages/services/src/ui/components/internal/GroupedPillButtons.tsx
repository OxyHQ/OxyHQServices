import type React from 'react';
import { View, TouchableOpacity, Text, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ButtonConfig {
    text: string;
    onPress: () => void;
    icon?: string;
    variant?: 'primary' | 'secondary' | 'transparent';
    disabled?: boolean;
    loading?: boolean;
    testID?: string;
}

interface GroupedPillButtonsProps {
    buttons: ButtonConfig[];
    colors: any;
    gap?: number;
}

const GroupedPillButtons: React.FC<GroupedPillButtonsProps> = ({
    buttons,
    colors,
    gap = 8,
}) => {
    const getButtonStyle = (button: ButtonConfig, index: number, totalButtons: number) => {
        const baseStyle = {
            flexDirection: 'row' as const,
            alignItems: 'center' as const,
            paddingVertical: 6,
            paddingHorizontal: 12,
            gap: 6,
            minWidth: 70,
            borderWidth: 1,
            flexShrink: 0,
        };

        // Determine border radius based on position
        let borderRadius = {
            borderTopLeftRadius: 35,
            borderBottomLeftRadius: 35,
            borderTopRightRadius: 35,
            borderBottomRightRadius: 35,
        };

        if (totalButtons > 1) {
            if (index === 0) {
                // First button
                borderRadius = {
                    borderTopLeftRadius: 35,
                    borderBottomLeftRadius: 35,
                    borderTopRightRadius: 12,
                    borderBottomRightRadius: 12,
                };
            } else if (index === totalButtons - 1) {
                // Last button
                borderRadius = {
                    borderTopLeftRadius: 12,
                    borderBottomLeftRadius: 12,
                    borderTopRightRadius: 35,
                    borderBottomRightRadius: 35,
                };
            } else {
                // Middle button (if 3 buttons)
                borderRadius = {
                    borderTopLeftRadius: 12,
                    borderBottomLeftRadius: 12,
                    borderTopRightRadius: 12,
                    borderBottomRightRadius: 12,
                };
            }
        }

        // Determine colors based on variant
        let backgroundColor = 'transparent';
        let borderColor = colors.border;
        const isDisabled = button.disabled || button.loading;

        switch (button.variant) {
            case 'primary':
                backgroundColor = isDisabled ? '#CCCCCC' : colors.primary;
                borderColor = isDisabled ? '#CCCCCC' : colors.primary;
                break;
            case 'secondary':
                backgroundColor = isDisabled ? '#CCCCCC' : (colors.secondary || colors.primary);
                borderColor = isDisabled ? '#CCCCCC' : (colors.secondary || colors.primary);
                break;
            case 'transparent':
            default:
                backgroundColor = 'transparent';
                borderColor = isDisabled ? '#CCCCCC' : colors.border;
                break;
        }

        return {
            ...baseStyle,
            ...borderRadius,
            backgroundColor,
            borderColor,
            opacity: isDisabled ? 0.6 : 1,
        };
    };

    const getTextStyle = (button: ButtonConfig, colors: any) => {
        const baseTextStyle = {
            fontSize: 15,
            fontWeight: '600' as const,
            // Avoid stretching that can cause wraps on native
            flexShrink: 1,
        };

        const isDisabled = button.disabled || button.loading;
        let textColor = colors.text;
        
        switch (button.variant) {
            case 'primary':
            case 'secondary':
                textColor = isDisabled ? '#999999' : '#FFFFFF';
                break;
            case 'transparent':
            default:
                textColor = isDisabled ? '#999999' : colors.text;
                break;
        }

        return {
            ...baseTextStyle,
            color: textColor,
            ...(Platform.OS === 'web' ? { whiteSpace: 'nowrap' as any } : null),
        };
    };

    const getIconColor = (button: ButtonConfig, colors: any) => {
        const isDisabled = button.disabled || button.loading;
        
        switch (button.variant) {
            case 'primary':
            case 'secondary':
                return isDisabled ? '#999999' : '#FFFFFF';
            case 'transparent':
            default:
                return isDisabled ? '#999999' : colors.text;
        }
    };

    const isBackButton = (button: ButtonConfig) => {
        const text = typeof button.text === 'string' ? button.text.toLowerCase() : '';
        return text.includes('back') ||
            button.icon === 'arrow-back' ||
            button.icon === 'chevron-back';
    };

    const renderButtonContent = (button: ButtonConfig, colors: any, index: number) => {
        const iconColor = getIconColor(button, colors);
        const isBack = isBackButton(button);
        const isFirstButton = index === 0;
        const isSingleButton = buttons.length === 1;

        if (button.loading) {
            return (
                <ActivityIndicator
                    color={iconColor}
                    size="small"
                />
            );
        }

        // Auto-detect icon placement based on button order and type
        if (isSingleButton) {
            // Single button: icon on right
            return (
                <>
                    <Text style={getTextStyle(button, colors)} numberOfLines={1} ellipsizeMode="tail">
                        {button.text}
                    </Text>
                    {button.icon && (
                        <Ionicons
                            name={button.icon as any}
                            size={16}
                            color={iconColor}
                        />
                    )}
                </>
            );
        } else if (isFirstButton || isBack) {
            // First button or back button: icon on left, text on right
            return (
                <>
                    {button.icon && (
                        <Ionicons
                            name={button.icon as any}
                            size={16}
                            color={iconColor}
                        />
                    )}
                    <Text style={getTextStyle(button, colors)} numberOfLines={1} ellipsizeMode="tail">
                        {button.text}
                    </Text>
                </>
            );
        } else {
            // Second button or forward/action button: text on left, icon on right
            return (
                <>
                    <Text style={getTextStyle(button, colors)} numberOfLines={1} ellipsizeMode="tail">
                        {button.text}
                    </Text>
                    {button.icon && (
                        <Ionicons
                            name={button.icon as any}
                            size={16}
                            color={iconColor}
                        />
                    )}
                </>
            );
        }
    };

    return (
        <View style={[styles.container, { gap }]}>
            {buttons.map((button, index) => (
                <TouchableOpacity
                    key={index}
                    style={getButtonStyle(button, index, buttons.length)}
                    onPress={button.onPress}
                    disabled={button.disabled || button.loading}
                    testID={button.testID}
                >
                    {renderButtonContent(button, colors, index)}
                </TouchableOpacity>
            ))}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        width: '100%',
    },
});

export default GroupedPillButtons; 
