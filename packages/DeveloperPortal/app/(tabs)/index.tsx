import React, { useState, useEffect } from 'react';
import { StyleSheet, FlatList, TouchableOpacity, View, Text, Alert, Clipboard } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter } from 'expo-router';

interface DeveloperApp {
  id: string;
  name: string;
  description?: string;
  apiKey: string;
  webhookUrl: string;
  devWebhookUrl?: string;
  status: string;
  scopes: string[];
  createdAt: string;
}

export default function HomeScreen() {
  const [apps, setApps] = useState<DeveloperApp[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const { oxyServices, user, isAuthenticated, showBottomSheet } = useOxy();

  useEffect(() => {
    if (isAuthenticated && user) {
      loadApps();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated, user]);

  const loadApps = async () => {
    if (!oxyServices) {
      console.log('OxyServices not available');
      return;
    }

    try {
      setLoading(true);
      console.log('Loading developer apps...');
      const data = await oxyServices.getDeveloperApps();
      console.log('Loaded apps:', data.length);
      setApps(data);
    } catch (error: any) {
      console.error('Error loading apps:', error);
      // Only show alert for errors other than auth errors
      if (error.status !== 401 && error.statusCode !== 401) {
        Alert.alert('Error', error.message || 'Failed to load apps');
      }
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    Clipboard.setString(text);
    Alert.alert('Copied', `${label} copied to clipboard`);
  };

  const handleDeleteApp = (appId: string, appName: string) => {
    Alert.alert(
      'Delete App',
      `Are you sure you want to delete "${appName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!oxyServices) return;
            try {
              await oxyServices.deleteDeveloperApp(appId);
              loadApps();
              Alert.alert('Success', 'App deleted successfully');
            } catch (error: any) {
              Alert.alert('Error', error.message || 'Failed to delete app');
            }
          },
        },
      ]
    );
  };

  const renderApp = ({ item }: { item: DeveloperApp }) => (
    <View style={styles.appCard}>
      <View style={styles.appHeader}>
        <ThemedText type="subtitle">{item.name}</ThemedText>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>

      {item.description && (
        <ThemedText style={styles.description}>{item.description}</ThemedText>
      )}

      <View style={styles.apiKeyContainer}>
        <ThemedText style={styles.label}>API Key:</ThemedText>
        <TouchableOpacity onPress={() => copyToClipboard(item.apiKey, 'API Key')}>
          <ThemedText style={styles.apiKey}>{item.apiKey}</ThemedText>
        </TouchableOpacity>
      </View>

      {item.webhookUrl && (
        <View style={styles.webhookContainer}>
          <ThemedText style={styles.label}>Webhook URL:</ThemedText>
          <ThemedText style={styles.webhookUrl} numberOfLines={1}>{item.webhookUrl}</ThemedText>
        </View>
      )}

      <View style={styles.actionsContainer}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => router.push(`/app/${item.id}`)}
        >
          <Text style={styles.actionButtonText}>View Details</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.deleteButton]}
          onPress={() => handleDeleteApp(item.id, item.name)}
        >
          <Text style={styles.deleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">My Developer Apps</ThemedText>
        {isAuthenticated && (
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/create-app')}
          >
            <Text style={styles.createButtonText}>+ Create App</Text>
          </TouchableOpacity>
        )}
      </View>

      {!isAuthenticated ? (
        <View style={styles.authPrompt}>
          <ThemedText type="subtitle">Sign in to continue</ThemedText>
          <ThemedText style={styles.authText}>
            Create developer apps and manage API keys by signing in with your Oxy account
          </ThemedText>
          <TouchableOpacity
            style={styles.signInButton}
            onPress={() => showBottomSheet?.('SignIn')}
          >
            <Text style={styles.signInButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <ThemedText style={styles.centerText}>Loading...</ThemedText>
      ) : apps.length === 0 ? (
        <View style={styles.emptyState}>
          <ThemedText type="subtitle">No apps yet</ThemedText>
          <ThemedText style={styles.emptyText}>Create your first developer app to get started with the Oxy API</ThemedText>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/create-app')}
          >
            <Text style={styles.createButtonText}>Create Your First App</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={apps}
          renderItem={renderApp}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  createButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  authPrompt: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  authText: {
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    opacity: 0.7,
  },
  signInButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  centerText: {
    textAlign: 'center',
    marginTop: 20,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
    opacity: 0.7,
  },
  listContent: {
    paddingBottom: 16,
  },
  appCard: {
    backgroundColor: '#F5F5F5',
    padding: 16,
    borderRadius: 12,
    marginBottom: 16,
  },
  appHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
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
  description: {
    opacity: 0.7,
    marginBottom: 12,
  },
  apiKeyContainer: {
    marginBottom: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
    opacity: 0.7,
  },
  apiKey: {
    fontFamily: 'monospace',
    fontSize: 14,
    color: '#007AFF',
  },
  webhookContainer: {
    marginBottom: 12,
  },
  webhookUrl: {
    fontSize: 12,
    fontFamily: 'monospace',
    opacity: 0.6,
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  actionButton: {
    flex: 1,
    backgroundColor: '#007AFF',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  deleteButton: {
    backgroundColor: '#FF3B30',
  },
  deleteButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
});
