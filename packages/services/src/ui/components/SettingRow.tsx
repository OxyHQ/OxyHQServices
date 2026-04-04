import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';

export interface SettingRowProps {
    title: string;
    description?: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
    disabled?: boolean;
    textColor?: string;
    mutedTextColor?: string;
    borderColor?: string;
    /** Active color for the switch track */
    activeColor?: string;
    /** Inactive color for the switch track */
    inactiveColor?: string;
    /** Accessibility label for the switch */
    accessibilityLabel?: string;
}

/**
 * Reusable setting row component with switch
 * Extracted from PrivacySettingsScreen for reuse across settings screens
 */
const SettingRow: React.FC<SettingRowProps> = ({
    title,
    description,
    value,
    onValueChange,
    disabled = false,
    textColor,
    mutedTextColor,
    borderColor,
    activeColor,
    inactiveColor,
    accessibilityLabel,
}) => {
    const theme = useTheme();

    const resolvedActiveColor = activeColor ?? theme.colors.primary;
    const resolvedInactiveColor = inactiveColor ?? theme.colors.textTertiary;
    const thumbOn = theme.colors.background;
    const thumbOff = theme.colors.backgroundSecondary;

    return (
        <View
            style={[styles.settingRow, borderColor ? { borderBottomColor: borderColor } : undefined]}
            accessibilityRole="none"
        >
            <View style={styles.settingInfo}>
                <Text
                    style={[styles.settingTitle, textColor ? { color: textColor } : undefined]}
                    accessibilityRole="text"
                >
                    {title}
                </Text>
                {description && (
                    <Text
                        style={[styles.settingDescription, mutedTextColor ? { color: mutedTextColor } : undefined]}
                        accessibilityRole="text"
                    >
                        {description}
                    </Text>
                )}
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                disabled={disabled}
                trackColor={{ false: resolvedInactiveColor, true: resolvedActiveColor }}
                thumbColor={value ? thumbOn : thumbOff}
                accessibilityRole="switch"
                accessibilityLabel={accessibilityLabel || title}
                accessibilityState={{ checked: value, disabled }}
                accessibilityHint={description}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    settingRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 16,
        borderBottomWidth: 1,
    },
    settingInfo: {
        flex: 1,
        marginRight: 16,
    },
    settingTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 4,
    },
    settingDescription: {
        fontSize: 14,
        opacity: 0.7,
    },
});

export default React.memo(SettingRow);
