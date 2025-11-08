import React, { useState, useEffect } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, Text, ScrollView, Clipboard } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useAppStore } from '@/store/useAppStore';
import { Alert } from '@/utils/alert';

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

    if (loading) {
        return (
            <ThemedView style={styles.container}>
                <ThemedText style={styles.centerText}>Loading...</ThemedText>
            </ThemedView>
        );
    }

    if (!app) {
        return (
            <ThemedView style={styles.container}>
                <ThemedText style={styles.centerText}>App not found</ThemedText>
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container}>
            <ScrollView>
                <View style={styles.header}>
                    <ThemedText type="title">{app.name}</ThemedText>
                    <View style={styles.statusBadge}>
                        <Text style={styles.statusText}>{app.status}</Text>
                    </View>
                </View>

                {newApiSecret && (
                    <View style={styles.secretCard}>
                        <ThemedText style={styles.warningText}>
                            ⚠️ Save your new API Secret now! You won't be able to see it again.
                        </ThemedText>
                        <View style={styles.secretContainer}>
                            <ThemedText style={styles.label}>New API Secret:</ThemedText>
                            <View style={styles.secretValueContainer}>
                                <Text style={styles.secretText} selectable>{newApiSecret}</Text>
                                <TouchableOpacity
                                    style={styles.copyIconButton}
                                    onPress={() => copyToClipboard(newApiSecret, 'API Secret')}
                                >
                                    <Text style={styles.copyIconText}>📋</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                        <TouchableOpacity
                            style={styles.dismissButton}
                            onPress={() => setNewApiSecret(null)}
                        >
                            <Text style={styles.dismissButtonText}>I've Saved It</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {editing ? (
                    <>
                        <View style={styles.formGroup}>
                            <ThemedText style={styles.label}>App Name</ThemedText>
                            <TextInput
                                style={styles.input}
                                value={name}
                                onChangeText={setName}
                                placeholder="My Awesome App"
                            />
                        </View>

                        <View style={styles.formGroup}>
                            <ThemedText style={styles.label}>Description</ThemedText>
                            <TextInput
                                style={[styles.input, styles.textArea]}
                                value={description}
                                onChangeText={setDescription}
                                placeholder="What does your app do?"
                                multiline
                                numberOfLines={4}
                            />
                        </View>

                        <View style={styles.formGroup}>
                            <ThemedText style={styles.label}>Production Webhook URL *</ThemedText>
                            <TextInput
                                style={styles.input}
                                value={webhookUrl}
                                onChangeText={setWebhookUrl}
                                placeholder="https://yourapp.com/api/webhooks/oxy"
                                keyboardType="url"
                                autoCapitalize="none"
                            />
                        </View>

                        <View style={styles.formGroup}>
                            <ThemedText style={styles.label}>Development Webhook URL (optional)</ThemedText>
                            <TextInput
                                style={styles.input}
                                value={devWebhookUrl}
                                onChangeText={setDevWebhookUrl}
                                placeholder="http://localhost:4000/webhook"
                                keyboardType="url"
                                autoCapitalize="none"
                            />
                            <View style={styles.quickFillContainer}>
                                <ThemedText style={styles.quickFillLabel}>Quick Fill:</ThemedText>
                                <View style={styles.quickFillButtons}>
                                    <TouchableOpacity
                                        style={styles.quickFillButton}
                                        onPress={() => setDevWebhookUrl('http://localhost:4000/webhook')}
                                    >
                                        <Text style={styles.quickFillButtonText}>:4000</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.quickFillButton}
                                        onPress={() => setDevWebhookUrl('http://localhost:3000/webhook')}
                                    >
                                        <Text style={styles.quickFillButtonText}>:3000</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.quickFillButton}
                                        onPress={() => setDevWebhookUrl('http://localhost:5000/webhook')}
                                    >
                                        <Text style={styles.quickFillButtonText}>:5000</Text>
                                    </TouchableOpacity>
                                </View>
                                <ThemedText style={styles.devNote}>
                                    💡 Run <Text style={styles.devCodeText}>node webhook-dev-server.js</Text> to test
                                </ThemedText>
                            </View>
                        </View>

                        <TouchableOpacity style={styles.saveButton} onPress={handleUpdate}>
                            <Text style={styles.saveButtonText}>Save Changes</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.cancelButton} onPress={() => setEditing(false)}>
                            <Text style={styles.cancelButtonText}>Cancel</Text>
                        </TouchableOpacity>
                    </>
                ) : (
                    <>
                        {app.description && (
                            <View style={styles.section}>
                                <ThemedText style={styles.sectionLabel}>Description</ThemedText>
                                <ThemedText style={styles.sectionText}>{app.description}</ThemedText>
                            </View>
                        )}

                        <View style={styles.section}>
                            <ThemedText style={styles.sectionLabel}>API Key</ThemedText>
                            <TouchableOpacity onPress={() => copyToClipboard(app.apiKey, 'API Key')}>
                                <Text style={styles.codeText}>{app.apiKey}</Text>
                            </TouchableOpacity>
                        </View>

                        <View style={styles.section}>
                            <ThemedText style={styles.sectionLabel}>Production Webhook URL</ThemedText>
                            <ThemedText style={styles.sectionText}>{app.webhookUrl}</ThemedText>
                        </View>

                        {app.devWebhookUrl && (
                            <View style={styles.section}>
                                <ThemedText style={styles.sectionLabel}>Development Webhook URL</ThemedText>
                                <ThemedText style={styles.sectionText}>{app.devWebhookUrl}</ThemedText>
                                <ThemedText style={styles.helperText}>
                                    Used for local testing and development
                                </ThemedText>
                            </View>
                        )}

                        {app.webhookSecret && (
                            <View style={styles.section}>
                                <ThemedText style={styles.sectionLabel}>Webhook Secret</ThemedText>
                                <TouchableOpacity onPress={() => copyToClipboard(app.webhookSecret, 'Webhook Secret')}>
                                    <Text style={styles.codeText}>{app.webhookSecret}</Text>
                                </TouchableOpacity>
                                <ThemedText style={styles.helperText}>
                                    Use this to verify webhook signatures
                                </ThemedText>
                            </View>
                        )}

                        <View style={styles.section}>
                            <ThemedText style={styles.sectionLabel}>Created</ThemedText>
                            <ThemedText style={styles.sectionText}>
                                {new Date(app.createdAt).toLocaleString()}
                            </ThemedText>
                        </View>

                        <TouchableOpacity style={styles.editButton} onPress={() => setEditing(true)}>
                            <Text style={styles.editButtonText}>Edit App</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.regenerateButton} onPress={handleRegenerateSecret}>
                            <Text style={styles.regenerateButtonText}>Regenerate API Secret</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
                            <Text style={styles.deleteButtonText}>Delete App</Text>
                        </TouchableOpacity>
                    </>
                )}
            </ScrollView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    centerText: {
        textAlign: 'center',
        marginTop: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    statusBadge: {
        backgroundColor: '#4CAF50',
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 4,
    },
    statusText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
    section: {
        marginBottom: 24,
    },
    sectionLabel: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 8,
        opacity: 0.7,
        textTransform: 'uppercase',
    },
    sectionText: {
        fontSize: 16,
    },
    codeText: {
        fontFamily: 'monospace',
        fontSize: 14,
        color: '#007AFF',
    },
    helperText: {
        fontSize: 12,
        opacity: 0.6,
        marginTop: 4,
    },
    formGroup: {
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 8,
    },
    input: {
        backgroundColor: '#F5F5F5',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    textArea: {
        height: 100,
        textAlignVertical: 'top',
    },
    quickFillContainer: {
        marginTop: 12,
        padding: 12,
        backgroundColor: '#F8F9FA',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    quickFillLabel: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 8,
        opacity: 0.7,
    },
    quickFillButtons: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    quickFillButton: {
        flex: 1,
        backgroundColor: '#E3F2FD',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: '#90CAF9',
    },
    quickFillButtonText: {
        color: '#1976D2',
        fontSize: 12,
        fontWeight: '600',
        textAlign: 'center',
    },
    devNote: {
        fontSize: 11,
        opacity: 0.7,
        fontStyle: 'italic',
    },
    devCodeText: {
        fontFamily: 'monospace',
        backgroundColor: '#F0F0F0',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 3,
        fontSize: 11,
    },
    editButton: {
        backgroundColor: '#007AFF',
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
    },
    editButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    regenerateButton: {
        backgroundColor: '#FF9500',
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
    },
    regenerateButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    deleteButton: {
        backgroundColor: '#FF3B30',
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
        marginBottom: 24,
    },
    deleteButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    saveButton: {
        backgroundColor: '#007AFF',
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
    },
    saveButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    cancelButton: {
        paddingVertical: 16,
        alignItems: 'center',
        marginTop: 8,
    },
    cancelButtonText: {
        color: '#007AFF',
        fontSize: 16,
    },
    secretCard: {
        backgroundColor: '#FFF9E6',
        borderWidth: 2,
        borderColor: '#FFB800',
        borderRadius: 12,
        padding: 20,
        marginBottom: 24,
    },
    warningText: {
        color: '#FF9500',
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 16,
        textAlign: 'center',
    },
    secretContainer: {
        marginBottom: 16,
    },
    secretValueContainer: {
        backgroundColor: '#FFFFFF',
        borderRadius: 8,
        padding: 12,
        borderWidth: 1,
        borderColor: '#E0E0E0',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    secretText: {
        fontFamily: 'monospace',
        fontSize: 13,
        color: '#007AFF',
        flex: 1,
    },
    copyIconButton: {
        padding: 8,
        marginLeft: 8,
    },
    copyIconText: {
        fontSize: 20,
    },
    dismissButton: {
        backgroundColor: '#007AFF',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    dismissButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
});

