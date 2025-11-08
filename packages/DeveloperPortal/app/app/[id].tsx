import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, Clipboard, Platform } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppStore } from '@/store/useAppStore';
import { Alert } from '@/utils/alert';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { GroupedItem } from '@/components/grouped-item';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loading } from '@/components/ui/loading';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function AppDetailsScreen() {
    const { id } = useLocalSearchParams();
    const [app, setApp] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [devWebhookUrl, setDevWebhookUrl] = useState('');
    const [newApiSecret, setNewApiSecret] = useState<string | null>(null);
    const router = useRouter();
    const { oxyServices } = useOxy();

    // Zustand store
    const { currentApp, setCurrentApp, updateApp, removeApp } = useAppStore();

    useEffect(() => {
        if (id && oxyServices) {
            loadApp();
        }
    }, [id, oxyServices]);

    const loadApp = async () => {
        if (!oxyServices) return;

        try {
            setLoading(true);
            const data = await oxyServices.getDeveloperApp(id as string);
            setApp(data);
            setCurrentApp(data); // Update Zustand store
            setName(data.name);
            setDescription(data.description || '');
            setWebhookUrl(data.webhookUrl || '');
            setDevWebhookUrl(data.devWebhookUrl || '');
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to load app');
            router.back();
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async () => {
        if (!oxyServices) return;

        if (!webhookUrl.trim()) {
            Alert.alert('Error', 'Production webhook URL is required');
            return;
        }

        try {
            const data: any = {};
            if (name !== app.name) data.name = name;
            if (description !== app.description) data.description = description;
            if (webhookUrl !== app.webhookUrl) data.webhookUrl = webhookUrl;
            if (devWebhookUrl !== app.devWebhookUrl) data.devWebhookUrl = devWebhookUrl;

            await oxyServices.updateDeveloperApp(id as string, data);

            // Update Zustand store
            updateApp(id as string, {
                name,
                description,
                webhookUrl,
                devWebhookUrl,
            });

            Alert.alert('Success', 'App updated successfully');
            setEditing(false);
            loadApp();
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to update app');
        }
    };

    const handleRegenerateSecret = () => {
        if (!oxyServices) {
            Alert.alert('Error', 'OxyServices not initialized');
            return;
        }

        Alert.confirm(
            'Regenerate API Secret',
            'This will invalidate the current API secret. Any applications using the old secret will stop working. Continue?',
            async () => {
                try {
                    console.log('Regenerating secret for app:', id);
                    const result = await oxyServices.regenerateDeveloperAppSecret(id as string);
                    console.log('Regenerate result:', result);

                    if (result && result.apiSecret) {
                        // Show the secret in the UI instead of an alert
                        setNewApiSecret(result.apiSecret);
                    } else {
                        Alert.alert('Error', 'No API secret returned');
                    }
                } catch (error: any) {
                    console.error('Regenerate error:', error);
                    Alert.alert('Error', error.message || 'Failed to regenerate secret');
                }
            },
            undefined,
            'Regenerate',
            'Cancel'
        );
    };

    const handleDelete = () => {
        if (!oxyServices) {
            Alert.alert('Error', 'OxyServices not initialized');
            return;
        }

        if (!app) {
            Alert.alert('Error', 'App data not loaded');
            return;
        }

        Alert.confirm(
            'Delete App',
            `Are you sure you want to delete "${app.name}"? This action cannot be undone.`,
            async () => {
                try {
                    console.log('Deleting app:', id);
                    await oxyServices.deleteDeveloperApp(id as string);
                    console.log('Delete successful');
                    removeApp(id as string); // Update Zustand store
                    Alert.alert('Success', 'App deleted successfully', [
                        { text: 'OK', onPress: () => router.back() }
                    ]);
                } catch (error: any) {
                    console.error('Delete error:', error);
                    Alert.alert('Error', error.message || 'Failed to delete app');
                }
            },
            undefined,
            'Delete',
            'Cancel'
        );
    };

    const copyToClipboard = (text: string, label: string) => {
        Clipboard.setString(text);
        Alert.alert('Copied', `${label} copied to clipboard`);
    };

    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];

    if (loading) {
        return (
            <ThemedView style={styles.container}>
                <Loading message="Loading app details..." />
            </ThemedView>
        );
    }

    if (!app) {
        return (
            <ThemedView style={styles.container}>
                <View style={styles.errorContainer}>
                    <ThemedText style={styles.errorText}>App not found</ThemedText>
                    <Button
                        title="Go Back"
                        onPress={() => router.back()}
                        style={styles.backButton}
                    />
                </View>
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* New API Secret Banner */}
                {newApiSecret && (
                    <Card style={[styles.secretBanner, { backgroundColor: '#FFF9E6', borderColor: '#FFB800' }]}>
                        <View style={styles.secretBannerContent}>
                            <Text style={styles.warningIcon}>⚠️</Text>
                            <View style={styles.secretBannerText}>
                                <ThemedText style={styles.secretBannerTitle}>
                                    Save your new API Secret
                                </ThemedText>
                                <ThemedText style={styles.secretBannerDesc}>
                                    You won't be able to see it again
                                </ThemedText>
                            </View>
                        </View>
                        <Card style={[styles.secretValueCard, { backgroundColor: colors.background }]}>
                            <Text style={styles.secretValue} selectable>{newApiSecret}</Text>
                            <IconButton
                                icon="clipboard"
                                onPress={() => copyToClipboard(newApiSecret, 'API Secret')}
                                size="small"
                            />
                        </Card>
                        <Button
                            title="I've Saved It"
                            onPress={() => setNewApiSecret(null)}
                            variant="primary"
                        />
                    </Card>
                )}

                {editing ? (
                    // Edit Mode
                    <>
                        <Section title="App Details">
                            <Card>
                                <Input
                                    label="App Name"
                                    value={name}
                                    onChangeText={setName}
                                    placeholder="My Awesome App"
                                />
                                <Input
                                    label="Description"
                                    value={description}
                                    onChangeText={setDescription}
                                    placeholder="What does your app do?"
                                    multiline
                                    numberOfLines={4}
                                    style={styles.textArea}
                                />
                            </Card>
                        </Section>

                        <Section title="Webhook Configuration">
                            <Card>
                                <Input
                                    label="Production Webhook URL *"
                                    value={webhookUrl}
                                    onChangeText={setWebhookUrl}
                                    placeholder="https://yourapp.com/api/webhooks/oxy"
                                    keyboardType="url"
                                    autoCapitalize="none"
                                />
                                <Input
                                    label="Development Webhook URL (optional)"
                                    value={devWebhookUrl}
                                    onChangeText={setDevWebhookUrl}
                                    placeholder="http://localhost:4000/webhook"
                                    keyboardType="url"
                                    autoCapitalize="none"
                                    helperText="💡 Run node webhook-dev-server.js to test locally"
                                />
                                <View style={styles.quickFillRow}>
                                    <Button
                                        title=":4000"
                                        onPress={() => setDevWebhookUrl('http://localhost:4000/webhook')}
                                        variant="secondary"
                                        size="small"
                                        style={styles.quickFillButton}
                                    />
                                    <Button
                                        title=":3000"
                                        onPress={() => setDevWebhookUrl('http://localhost:3000/webhook')}
                                        variant="secondary"
                                        size="small"
                                        style={styles.quickFillButton}
                                    />
                                    <Button
                                        title=":5000"
                                        onPress={() => setDevWebhookUrl('http://localhost:5000/webhook')}
                                        variant="secondary"
                                        size="small"
                                        style={styles.quickFillButton}
                                    />
                                </View>
                            </Card>
                        </Section>

                        <View style={styles.actionButtons}>
                            <Button
                                title="Save Changes"
                                onPress={handleUpdate}
                                variant="primary"
                                style={styles.saveButton}
                            />
                            <Button
                                title="Cancel"
                                onPress={() => {
                                    setEditing(false);
                                    // Reset values
                                    setName(app.name);
                                    setDescription(app.description || '');
                                    setWebhookUrl(app.webhookUrl || '');
                                    setDevWebhookUrl(app.devWebhookUrl || '');
                                }}
                                variant="ghost"
                            />
                        </View>
                    </>
                ) : (
                    // View Mode
                    <>
                        <View style={styles.header}>
                            <ThemedText type="title">{app.name}</ThemedText>
                            <Badge label={app.status} variant="success" />
                        </View>

                        {app.description && (
                            <Section title="Description">
                                <Card>
                                    <ThemedText>{app.description}</ThemedText>
                                </Card>
                            </Section>
                        )}

                        <Section title="API Credentials">
                            <GroupedSection items={[
                                {
                                    id: 'apiKey',
                                    icon: 'key' as any,
                                    title: 'API Key',
                                    subtitle: app.apiKey,
                                    onPress: () => copyToClipboard(app.apiKey, 'API Key'),
                                    showChevron: true,
                                },
                                ...(app.webhookSecret ? [{
                                    id: 'webhookSecret',
                                    icon: 'lock-closed' as any,
                                    title: 'Webhook Secret',
                                    subtitle: app.webhookSecret?.substring(0, 20) + '...',
                                    onPress: () => copyToClipboard(app.webhookSecret, 'Webhook Secret'),
                                    showChevron: true,
                                }] : [])
                            ]} />
                        </Section>

                        <Section title="Webhooks">
                            <GroupedSection items={[
                                {
                                    id: 'prodWebhook',
                                    icon: 'globe' as any,
                                    title: 'Production URL',
                                    subtitle: app.webhookUrl,
                                    multiRow: true,
                                },
                                ...(app.devWebhookUrl ? [{
                                    id: 'devWebhook',
                                    icon: 'code' as any,
                                    title: 'Development URL',
                                    subtitle: app.devWebhookUrl,
                                    multiRow: true,
                                }] : [])
                            ]} />
                        </Section>

                        <Section title="Information">
                            <GroupedSection items={[
                                {
                                    id: 'created',
                                    icon: 'calendar' as any,
                                    title: 'Created',
                                    subtitle: new Date(app.createdAt).toLocaleString(),
                                },
                                {
                                    id: 'updated',
                                    icon: 'time' as any,
                                    title: 'Last Updated',
                                    subtitle: new Date(app.updatedAt || app.createdAt).toLocaleString(),
                                }
                            ]} />
                        </Section>

                        <Section title="Actions">
                            <GroupedSection items={[
                                {
                                    id: 'edit',
                                    icon: 'create' as any,
                                    title: 'Edit App',
                                    onPress: () => setEditing(true),
                                    showChevron: true,
                                },
                                {
                                    id: 'regenerate',
                                    icon: 'refresh' as any,
                                    title: 'Regenerate API Secret',
                                    onPress: handleRegenerateSecret,
                                    showChevron: true,
                                },
                                {
                                    id: 'delete',
                                    icon: 'trash' as any,
                                    title: 'Delete App',
                                    onPress: handleDelete,
                                    showChevron: true,
                                }
                            ]} />
                        </Section>
                    </>
                )}
            </ScrollView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 16,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    errorText: {
        fontSize: 16,
        marginBottom: 16,
    },
    backButton: {
        marginTop: 16,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    secretBanner: {
        marginBottom: 24,
        padding: 16,
        borderWidth: 2,
    },
    secretBannerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 12,
    },
    warningIcon: {
        fontSize: 24,
        marginRight: 12,
    },
    secretBannerText: {
        flex: 1,
    },
    secretBannerTitle: {
        fontSize: 16,
        fontWeight: '700',
        marginBottom: 4,
    },
    secretBannerDesc: {
        fontSize: 14,
        opacity: 0.7,
    },
    secretValueCard: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 12,
        marginBottom: 12,
    },
    secretValue: {
        flex: 1,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 13,
        color: '#007AFF',
    },
    textArea: {
        marginTop: 12,
    },
    quickFillRow: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 12,
    },
    quickFillButton: {
        flex: 1,
    },
    actionButtons: {
        marginTop: 24,
        gap: 12,
    },
    saveButton: {
        marginBottom: 8,
    },
});

