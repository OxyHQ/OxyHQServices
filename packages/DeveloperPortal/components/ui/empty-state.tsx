import React from 'react';
import { View, StyleSheet } from 'react-native';
import { ThemedText } from '../themed-text';
import { Ionicons } from '@expo/vector-icons';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface EmptyStateProps {
    icon?: keyof typeof Ionicons.glyphMap;
    title: string;
    message?: string;
    action?: React.ReactNode;
}

export function EmptyState({ icon = 'cube-outline', title, message, action }: EmptyStateProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    return (
        <View style={styles.container}>
            <Ionicons name={icon} size={64} color={colors.icon} />
            <ThemedText type="title" style={styles.title}>{title}</ThemedText>
            {message && (
                <ThemedText style={styles.message}>{message}</ThemedText>
            )}
            {action && (
                <View style={styles.action}>{action}</View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 40,
        paddingVertical: 60,
    },
    title: {
        marginTop: 20,
        textAlign: 'center',
    },
    message: {
        textAlign: 'center',
        marginTop: 12,
        opacity: 0.7,
        fontSize: 16,
        lineHeight: 24,
    },
    action: {
        marginTop: 32,
    },
});
