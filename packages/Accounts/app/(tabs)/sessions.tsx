import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';
import { ScreenHeader } from '@/components/ui';

export default function SessionsScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    return (
        <ScreenContentWrapper>
        <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.content}>
                <ScreenHeader title="Sessions" subtitle="Manage your active sessions." />
                <View style={styles.placeholder}>
                    <Text style={[styles.placeholderText, { color: colors.icon }]}>
                        Sessions management coming soon
                    </Text>
                </View>
                </View>
        </View>
        </ScreenContentWrapper>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollView: {
        flex: 1,
    },
    content: {
        padding: 20,
    },
    headerSection: {
        marginBottom: 24,
    },
    title: {
        fontSize: 32,
        fontWeight: '600',
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 16,
        opacity: 0.6,
    },
    placeholder: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 60,
    },
    placeholderText: {
        fontSize: 16,
    },
});
