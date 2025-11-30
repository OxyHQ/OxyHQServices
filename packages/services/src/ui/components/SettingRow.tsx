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
}) => {
    return (
        <View style={[styles.settingRow, borderColor ? { borderBottomColor: borderColor } : undefined]}>
            <View style={styles.settingInfo}>
                <Text style={[styles.settingTitle, textColor ? { color: textColor } : undefined]}>
                    {title}
                </Text>
                {description && (
                    <Text style={[styles.settingDescription, mutedTextColor ? { color: mutedTextColor } : undefined]}>
                        {description}
                    </Text>
                )}
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                disabled={disabled}
                trackColor={{ false: '#767577', true: '#d169e5' }}
                thumbColor={value ? '#fff' : '#f4f3f4'}
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

