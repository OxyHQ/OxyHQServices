import React from 'react';
import { StyleSheet, FlatList, TouchableOpacity, View, Text, Alert, Clipboard } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useAppStore, DeveloperApp } from '@/store/useAppStore';
import { useLoadApps } from '@/hooks/useLoadApps';

export default function HomeScreen() {
  const router = useRouter();
  const { oxyServices, user, isAuthenticated, showBottomSheet } = useOxy();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  // Zustand store
  const { apps, loading, removeApp } = useAppStore();

  // Load apps hook
  useLoadApps();

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
              removeApp(appId); // Update Zustand store
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
    <TouchableOpacity
      style={[styles.appCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
      onPress={() => router.push(`/app/${item.id}`)}
      activeOpacity={0.7}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardTitleRow}>
          <Ionicons
            name="cube-outline"
            size={24}
            color={colors.tint}
            style={styles.cardIcon}
          />
          <View style={styles.cardTitleContainer}>
            <ThemedText type="subtitle" style={styles.appName}>{item.name}</ThemedText>
            {item.description && (
              <ThemedText style={[styles.description, { color: colors.icon }]}>
                {item.description}
              </ThemedText>
            )}
          </View>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: item.status === 'active' ? '#34C759' : '#FF9500' }]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>

      <View style={[styles.infoSection, { borderTopColor: colorScheme === 'dark' ? '#2C2C2E' : '#E5E5EA' }]}>
        <View style={styles.infoRow}>
          <View style={styles.infoLabel}>
            <Ionicons name="key-outline" size={14} color={colors.icon} />
            <ThemedText style={[styles.label, { color: colors.icon }]}>API Key</ThemedText>
          </View>
          <TouchableOpacity
            onPress={() => copyToClipboard(item.apiKey, 'API Key')}
            style={styles.copyButton}
          >
            <ThemedText style={[styles.apiKey, { color: colors.tint }]} numberOfLines={1}>
              {item.apiKey.substring(0, 20)}...
            </ThemedText>
            <Ionicons name="copy-outline" size={16} color={colors.tint} />
          </TouchableOpacity>
        </View>

        <View style={styles.infoRow}>
          <View style={styles.infoLabel}>
            <Ionicons name="globe-outline" size={14} color={colors.icon} />
            <ThemedText style={[styles.label, { color: colors.icon }]}>Webhook</ThemedText>
          </View>
          <ThemedText style={[styles.webhookUrl, { color: colors.icon }]} numberOfLines={1}>
            {item.webhookUrl}
          </ThemedText>
        </View>

        {item.scopes && item.scopes.length > 0 && (
          <View style={styles.scopesContainer}>
            <View style={styles.infoLabel}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.icon} />
              <ThemedText style={[styles.label, { color: colors.icon }]}>Scopes</ThemedText>
            </View>
            <View style={styles.scopesRow}>
              {item.scopes.map((scope, idx) => (
                <View key={idx} style={[styles.scopeBadge, { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7' }]}>
                  <Text style={[styles.scopeText, { color: colors.text }]}>{scope}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>

      <View style={styles.cardFooter}>
        <ThemedText style={[styles.timestamp, { color: colors.icon }]}>
          Created {new Date(item.createdAt).toLocaleDateString()}
        </ThemedText>
        <Ionicons name="chevron-forward" size={20} color={colors.icon} />
      </View>
    </TouchableOpacity>
  );

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <ThemedText type="title">Developer Apps</ThemedText>
          {isAuthenticated && apps.length > 0 && (
            <View style={[styles.countBadge, { backgroundColor: colors.tint }]}>
              <Text style={styles.countText}>{apps.length}</Text>
            </View>
          )}
        </View>
        <View style={styles.headerRight}>
          {isAuthenticated && (
            <TouchableOpacity
              style={styles.createButton}
              onPress={() => router.push('/create-app')}
            >
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.createButtonText}>New</Text>
            </TouchableOpacity>
          )}
          <UserAvatar />
        </View>
      </View>

      {!isAuthenticated ? (
        <View style={styles.authPrompt}>
          <Ionicons name="lock-closed-outline" size={64} color={colors.icon} />
          <ThemedText type="title" style={{ marginTop: 20 }}>Sign in Required</ThemedText>
          <ThemedText style={styles.authText}>
            Create and manage developer apps with API keys and webhooks
          </ThemedText>
          <TouchableOpacity
            style={styles.signInButton}
            onPress={() => showBottomSheet?.('SignIn')}
          >
            <Text style={styles.signInButtonText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      ) : loading ? (
        <View style={styles.emptyState}>
          <ThemedText style={styles.centerText}>Loading apps...</ThemedText>
        </View>
      ) : apps.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="cube-outline" size={64} color={colors.icon} />
          <ThemedText type="title" style={{ marginTop: 20 }}>No Apps Yet</ThemedText>
          <ThemedText style={styles.emptyText}>
            Create your first developer app to access the Oxy API
          </ThemedText>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => router.push('/create-app')}
          >
            <Ionicons name="add" size={20} color="#FFFFFF" />
            <Text style={styles.createButtonText}>Create First App</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={apps}
          renderItem={renderApp}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  countBadge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  countText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  createButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  authPrompt: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  authText: {
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 32,
    opacity: 0.7,
    fontSize: 16,
    lineHeight: 24,
  },
  signInButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 40,
    paddingVertical: 16,
    borderRadius: 12,
    minWidth: 200,
    alignItems: 'center',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  signInButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  centerText: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 16,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 32,
    opacity: 0.7,
    fontSize: 16,
    lineHeight: 24,
  },
  listContent: {
    padding: 20,
    paddingTop: 8,
  },
  appCard: {
    borderRadius: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    paddingBottom: 12,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
  },
  cardIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  cardTitleContainer: {
    flex: 1,
  },
  appName: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  statusText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoSection: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
    borderTopWidth: 1,
  },
  infoRow: {
    marginBottom: 12,
  },
  infoLabel: {
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
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  apiKey: {
    fontFamily: 'monospace',
    fontSize: 13,
    fontWeight: '500',
  },
  webhookUrl: {
    fontSize: 12,
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  scopesContainer: {
    marginBottom: 8,
  },
  scopesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  scopeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  scopeText: {
    fontSize: 11,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  timestamp: {
    fontSize: 12,
  },
});
