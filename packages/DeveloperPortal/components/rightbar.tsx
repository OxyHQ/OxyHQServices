import React from 'react';
import { View, StyleSheet, Text, Platform } from 'react-native';
import { ThemedView } from './themed-view';
import { ThemedText } from './themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Section } from './section';
import { GroupedSection } from './grouped-section';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './ui/card';

export function RightBar() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    // Only show on web
    if (Platform.OS !== 'web') {
        return null;
    }

    return (
        <ThemedView style={styles.container}>
            <View style={styles.content}>
                <Section title="Quick Links">
                    <GroupedSection
                        items={[
                            {
                                id: 'docs',
                                icon: 'book-outline',
                                iconColor: colors.tint,
                                title: 'API Documentation',
                                subtitle: 'View full API reference',
                                showChevron: true,
                            },
                            {
                                id: 'webhook',
                                icon: 'code-slash',
                                iconColor: '#FF9500',
                                title: 'Webhook Guide',
                                subtitle: 'Setup webhook endpoints',
                                showChevron: true,
                            },
                            {
                                id: 'examples',
                                icon: 'code-working',
                                iconColor: '#34C759',
                                title: 'Code Examples',
                                subtitle: 'Sample implementations',
                                showChevron: true,
                            },
                        ]}
                    />
                </Section>

                <Card style={styles.helpCard}>
                    <View style={[styles.helpIcon, { backgroundColor: colors.tint + '20' }]}>
                        <Ionicons name="help-circle" size={24} color={colors.tint} />
                    </View>
                    <ThemedText style={styles.helpTitle}>Need Help?</ThemedText>
                    <ThemedText style={styles.helpText}>
                        Check our documentation or reach out to support for assistance.
                    </ThemedText>
                </Card>

                <Card style={styles.statusCard}>
                    <View style={styles.statusRow}>
                        <View style={[styles.statusDot, { backgroundColor: '#34C759' }]} />
                        <ThemedText style={styles.statusText}>All Systems Operational</ThemedText>
                    </View>
                </Card>
            </View>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 300,
        padding: 20,
    },
    content: {
        gap: 20,
    },
    helpCard: {
        padding: 16,
        alignItems: 'center',
    },
    helpIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
    },
    helpTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
    },
    helpText: {
        fontSize: 13,
        opacity: 0.7,
        textAlign: 'center',
    },
    statusCard: {
        padding: 12,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    statusText: {
        fontSize: 13,
        fontWeight: '500',
    },
});
