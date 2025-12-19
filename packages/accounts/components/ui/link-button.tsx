import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useHapticPress } from '@/hooks/use-haptic-press';
import type { MaterialCommunityIconName } from '@/types/icons';

interface LinkButtonProps {
    text: string;
    onPress?: () => void;
    icon?: MaterialCommunityIconName;
    count?: string | number;
}

export function LinkButton({ text, onPress, icon, count }: LinkButtonProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const handlePressIn = useHapticPress();

    return (
        <TouchableOpacity style={styles.linkButton} onPressIn={handlePressIn} onPress={onPress}>
            {icon && <MaterialCommunityIcons name={icon} size={16} color={colors.tint} />}
            <Text style={[styles.linkText, { color: colors.tint }]}>{text}</Text>
            {count !== undefined && (
                <Text style={[styles.linkCount, { color: colors.secondaryText }]}>{count}</Text>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    linkButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        gap: 6,
    },
    linkText: {
        fontSize: 14,
        fontWeight: '500',
    },
    linkCount: {
        fontSize: 14,
        marginLeft: 4,
    },
});

