import React, { useEffect, useState } from 'react';
import { View, StyleSheet, Text, Platform, ActivityIndicator, Linking } from 'react-native';
import { ThemedView } from './themed-view';
import { ThemedText } from './themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Section } from './section';
import { GroupedSection } from './grouped-section';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './ui/card';
import { router } from 'expo-router';

type SystemStatus = {
    status: 'operational' | 'degraded' | 'down' | 'loading';
    message: string;
    color: string;
};

export function RightBar() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const [systemStatus, setSystemStatus] = useState<SystemStatus>({
        status: 'loading',
        message: 'Checking status...',
        color: '#8E8E93',
    });

    useEffect(() => {
        const checkStatus = async () => {
            try {
                const baseURL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
                const response = await fetch(`${baseURL}/health`, {
                    method: 'GET',
                    signal: AbortSignal.timeout(5000), // 5 second timeout
                });

                if (response.ok) {
                    setSystemStatus({
                        status: 'operational',
                        message: 'All Systems Operational',
                        color: '#34C759',
                    });
                } else {
                    setSystemStatus({
                        status: 'degraded',
                        message: 'Degraded Performance',
                        color: '#FF9500',
                    });
                }
            } catch (error) {
                setSystemStatus({
                    status: 'down',
                    message: 'System Unavailable',
                    color: '#FF3B30',
                });
            }
        };

        checkStatus();
        // Check status every 60 seconds
        const interval = setInterval(checkStatus, 60000);

        return () => clearInterval(interval);
    }, []);

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
                                onPress: () => {
                                    router.push('/(tabs)/explore');
                                },
                            },
                            {
                                id: 'webhook',
                                icon: 'code-slash',
                                iconColor: '#FF9500',
                                title: 'Webhook Guide',
                                subtitle: 'Setup webhook endpoints',
                                showChevron: true,
                                onPress: () => {
                                    router.push('/(tabs)/explore?section=webhooks');
                                },
                            },
                            {
                                id: 'examples',
                                icon: 'code-working',
                                iconColor: '#34C759',
                                title: 'Code Examples',
                                subtitle: 'Sample implementations',
                                showChevron: true,
                                onPress: () => {
                                    Linking.openURL('https://github.com/OxyHQ/examples');
                                },
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
                        {systemStatus.status === 'loading' ? (
                            <ActivityIndicator size="small" color={colors.tint} />
                        ) : (
                            <View style={[styles.statusDot, { backgroundColor: systemStatus.color }]} />
                        )}
                        <ThemedText style={styles.statusText}>{systemStatus.message}</ThemedText>
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
