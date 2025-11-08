import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '../themed-text';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface InfoRowProps {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    value: string;
    onPress?: () => void;
    actionIcon?: keyof typeof Ionicons.glyphMap;
}

export function InfoRow({ icon, label, value, onPress, actionIcon = 'copy-outline' }: InfoRowProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const content = (
        <>
            <View style={styles.labelContainer}>
                <Ionicons name={icon} size={14} color={colors.icon} />
                <ThemedText style={[styles.label, { color: colors.icon }]}>{label}</ThemedText>
            </View>
            <View style={styles.valueContainer}>
                <ThemedText style={styles.value} numberOfLines={1}>{value}</ThemedText>
                {onPress && (
                    <Ionicons name={actionIcon} size={16} color={colors.tint} style={styles.actionIcon} />
                )}
            </View>
        </>
    );

    if (onPress) {
        return (
            <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={0.7}>
                {content}
            </TouchableOpacity>
        );
    }

    return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
    container: {
        marginBottom: 12,
    },
    labelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
    },
    label: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    valueContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    value: {
        fontSize: 13,
        flex: 1,
    },
    actionIcon: {
        marginLeft: 4,
    },
});
