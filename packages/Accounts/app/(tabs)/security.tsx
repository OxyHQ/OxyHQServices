import React from 'react';
import { View, ScrollView, StyleSheet, Text } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';

export default function SecurityScreen() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <ScrollView
                style={styles.scrollView}
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
            >
                <View style={styles.headerSection}>
                    <ThemedText style={styles.title}>Security</ThemedText>
                    <ThemedText style={styles.subtitle}>Manage your security settings.</ThemedText>
                </View>
                <View style={styles.placeholder}>
                    <Text style={[styles.placeholderText, { color: colors.icon }]}>
                        Security settings coming soon
                    </Text>
                </View>
            </ScrollView>
        </View>
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
