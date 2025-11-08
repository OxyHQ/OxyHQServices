import React, { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View, Text, ScrollView, Alert } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter } from 'expo-router';
import { useAppStore } from '@/store/useAppStore';

export default function CreateAppScreen() {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [webhookUrl, setWebhookUrl] = useState('');
    const [devWebhookUrl, setDevWebhookUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [apiSecret, setApiSecret] = useState<string | null>(null);
    const router = useRouter();
    const { oxyServices } = useOxy();

    // Zustand store
    const { addApp } = useAppStore();

    const handleCreate = async () => {
        if (!name.trim()) {
            Alert.alert('Error', 'App name is required');
            return;
        }

        if (!webhookUrl.trim()) {
            Alert.alert('Error', 'Production webhook URL is required');
            return;
        }

        if (!oxyServices) {
            Alert.alert('Error', 'Please sign in to create an app');
            return;
        }

        try {
            setLoading(true);
            const data: any = {
                name,
                webhookUrl: webhookUrl.trim()
            };
            if (description.trim()) data.description = description;
            if (devWebhookUrl.trim()) data.devWebhookUrl = devWebhookUrl.trim();

            const result = await oxyServices.createDeveloperApp(data);

            // Add to Zustand store
            addApp(result);

            // Show the API secret (only shown once!)
            if (result.apiSecret) {
                setApiSecret(result.apiSecret);
            } else {
                router.back();
            }
        } catch (error: any) {
            Alert.alert('Error', error.message || 'Failed to create app');
        } finally {
            setLoading(false);
        }
    };

    if (apiSecret) {
        return (
            <ThemedView style={styles.container}>
                <View style={styles.successContainer}>
                    <ThemedText type="title" style={styles.successTitle}>App Created!</ThemedText>
                    <ThemedText style={styles.warningText}>
                        ⚠️ Save your API Secret now! You won't be able to see it again.
                    </ThemedText>

                    <View style={styles.secretCard}>
                        <ThemedText style={styles.label}>API Secret:</ThemedText>
                        <Text style={styles.secretText} selectable>{apiSecret}</Text>
                    </View>

                    <TouchableOpacity
                        style={styles.doneButton}
                        onPress={() => router.back()}
                    >
                        <Text style={styles.doneButtonText}>Done</Text>
                    </TouchableOpacity>
                </View>
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container}>
            <ScrollView>
                <ThemedText type="title" style={styles.title}>Create Developer App</ThemedText>

                <View style={styles.formGroup}>
                    <ThemedText style={styles.label}>App Name *</ThemedText>
                    <TextInput
                        style={styles.input}
                        value={name}
                        onChangeText={setName}
                        placeholder="My Awesome App"
                        placeholderTextColor="#999"
                    />
                </View>

                <View style={styles.formGroup}>
                    <ThemedText style={styles.label}>Description</ThemedText>
                    <TextInput
                        style={[styles.input, styles.textArea]}
                        value={description}
                        onChangeText={setDescription}
                        placeholder="What does your app do?"
                        placeholderTextColor="#999"
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
                        placeholderTextColor="#999"
                        keyboardType="url"
                        autoCapitalize="none"
                    />
                    <ThemedText style={styles.helperText}>
                        Your production server endpoint for webhook notifications
                    </ThemedText>
                </View>

                <View style={styles.formGroup}>
                    <ThemedText style={styles.label}>Development Webhook URL (optional)</ThemedText>
                    <TextInput
                        style={styles.input}
                        value={devWebhookUrl}
                        onChangeText={setDevWebhookUrl}
                        placeholder="http://localhost:4000/webhook"
                        placeholderTextColor="#999"
                        keyboardType="url"
                        autoCapitalize="none"
                    />
                    <ThemedText style={styles.helperText}>
                        Local development endpoint for testing webhooks
                    </ThemedText>

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
                            💡 Run <Text style={styles.codeText}>node webhook-dev-server.js</Text> to test locally
                        </ThemedText>
                    </View>
                </View>

                <TouchableOpacity
                    style={[styles.createButton, loading && styles.buttonDisabled]}
                    onPress={handleCreate}
                    disabled={loading}
                >
                    <Text style={styles.createButtonText}>
                        {loading ? 'Creating...' : 'Create App'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => router.back()}
                >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
            </ScrollView>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 16,
    },
    title: {
        marginBottom: 24,
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
    helperText: {
        fontSize: 12,
        opacity: 0.6,
        marginTop: 4,
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
    codeText: {
        fontFamily: 'monospace',
        backgroundColor: '#F0F0F0',
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 3,
        fontSize: 11,
    },
    createButton: {
        backgroundColor: '#007AFF',
        paddingVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
    },
    createButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    buttonDisabled: {
        opacity: 0.5,
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
    successContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    successTitle: {
        marginBottom: 16,
    },
    warningText: {
        textAlign: 'center',
        color: '#FF9500',
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 24,
    },
    secretCard: {
        backgroundColor: '#F5F5F5',
        padding: 16,
        borderRadius: 12,
        width: '100%',
        marginBottom: 24,
    },
    secretText: {
        fontFamily: 'monospace',
        fontSize: 14,
        color: '#007AFF',
    },
    doneButton: {
        backgroundColor: '#007AFF',
        paddingHorizontal: 32,
        paddingVertical: 16,
        borderRadius: 8,
    },
    doneButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});
