import React from 'react';
import { View, Text, Switch, StyleSheet } from 'react-native';

export interface SettingRowProps {
    title: string;
    description?: string;
    value: boolean;
    onValueChange: (value: boolean) => void;
    disabled?: boolean;
    textColor?: string;
    mutedTextColor?: string;
    borderColor?: string;
    /** Active color for the switch track (default: #d169e5) */
    activeColor?: string;
    /** Inactive color for the switch track (default: #767577) */
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
    activeColor = '#d169e5',
    inactiveColor = '#767577',
    accessibilityLabel,
}) => {
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
                trackColor={{ false: inactiveColor, true: activeColor }}
                thumbColor={value ? '#fff' : '#f4f3f4'}
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

