import React from 'react';
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
            ...Platform.select({
                web: {
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                },
                default: {
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 4,
                    elevation: 2,
                }
            }),
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
        let shadowColor = colors.border;
        let textColor = colors.text;

        switch (button.variant) {
            case 'primary':
                backgroundColor = colors.primary;
                borderColor = colors.primary;
                shadowColor = colors.primary;
                textColor = '#FFFFFF';
                break;
            case 'secondary':
                backgroundColor = colors.secondary || colors.primary;
                borderColor = colors.secondary || colors.primary;
                shadowColor = colors.secondary || colors.primary;
                textColor = '#FFFFFF';
                break;
            case 'transparent':
            default:
                backgroundColor = 'transparent';
                borderColor = colors.border;
                shadowColor = colors.border;
                textColor = colors.text;
                break;
        }

        return {
            ...baseStyle,
            ...borderRadius,
            backgroundColor,
            borderColor,
            shadowColor,
        };
    };

    const getTextStyle = (button: ButtonConfig, colors: any) => {
        const baseTextStyle = {
            fontSize: 15,
            fontWeight: '600' as const,
            flex: 1,
        };

        let textColor = colors.text;
        switch (button.variant) {
            case 'primary':
            case 'secondary':
                textColor = '#FFFFFF';
                break;
            case 'transparent':
            default:
                textColor = colors.text;
                break;
        }

        return {
            ...baseTextStyle,
            color: textColor,
        };
    };

    const getIconColor = (button: ButtonConfig, colors: any) => {
        switch (button.variant) {
            case 'primary':
            case 'secondary':
                return '#FFFFFF';
            case 'transparent':
            default:
                return colors.text;
        }
    };

    const isBackButton = (button: ButtonConfig) => {
        return button.text.toLowerCase().includes('back') ||
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
                    <Text style={getTextStyle(button, colors)}>
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
                    <Text style={getTextStyle(button, colors)}>
                        {button.text}
                    </Text>
                </>
            );
        } else {
            // Second button or forward/action button: text on left, icon on right
            return (
                <>
                    <Text style={getTextStyle(button, colors)}>
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
        justifyContent: 'center',
        marginTop: 16,
        marginBottom: 8,
        width: '100%',
    },
});

export default GroupedPillButtons; 