import React from 'react';
import { StyleSheet, ScrollView, View, Text, Clipboard, useWindowDimensions, Platform } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { ThemedText, ThemedView, Section, GroupedSection } from '@/components';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useAppStore, DeveloperApp } from '@/store/useAppStore';
import { useLoadApps } from '@/hooks/useLoadApps';
import { toast } from 'sonner-native';

export default function HomeScreen() {
  const router = useRouter();
  const { oxyServices, user, isAuthenticated, showBottomSheet } = useOxy();
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { width } = useWindowDimensions();

  // Responsive layout
  const isDesktop = Platform.OS === 'web' && width >= 1024;
  const isTablet = Platform.OS === 'web' && width >= 768 && width < 1024;
  const columns = isDesktop ? 3 : isTablet ? 2 : 1;

  // Zustand store
  const { apps, loading, removeApp } = useAppStore();

  // Load apps hook
  useLoadApps();

  const copyToClipboard = (text: string, label: string) => {
    Clipboard.setString(text);
    toast.success(`${label} copied to clipboard`);
  };

  return (
    <ThemedView style={styles.container}>
      <View style={[styles.header, { backgroundColor: colors.background }]}>
        <View style={styles.headerLeft}>
          <ThemedText type="title">Developer Apps</ThemedText>
          {isAuthenticated && apps.length > 0 && (
            <Badge label={apps.length.toString()} variant="primary" />
          )}
        </View>
        <View style={styles.headerRight}>
          {isAuthenticated && (
            <Button
              title="New"
              onPress={() => router.push('/create-app')}
              icon="add"
              size="small"
            />
          )}
          <UserAvatar />
        </View>
      </View>

      {!isAuthenticated ? (
        <EmptyState
          icon="lock-closed-outline"
          title="Sign in Required"
          message="Create and manage developer apps with API keys and webhooks"
          action={
            <Button
              title="Sign In"
              onPress={() => showBottomSheet?.('SignIn')}
              icon="log-in"
              size="large"
            />
          }
        />
      ) : loading ? (
        <EmptyState
          icon="sync"
          title="Loading..."
          message="Fetching your developer apps"
        />
      ) : apps.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title="No Apps Yet"
          message="Create your first developer app to access the Oxy API"
          action={
            <Button
              title="Create First App"
              onPress={() => router.push('/create-app')}
              icon="add-circle"
              size="large"
            />
          }
        />
      ) : (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <View style={[
            styles.gridContainer,
            columns > 1 && { flexDirection: 'row', flexWrap: 'wrap', gap: 16 }
          ]}>
            {apps.map((app) => (
              <View 
                key={app.id} 
                style={[
                  styles.gridItem,
                  columns === 3 && styles.gridItem3Columns,
                  columns === 2 && styles.gridItem2Columns,
                  columns === 1 && styles.gridItem1Column,
                ]}
              >
                <Section title={app.name}>
                  <GroupedSection
                    items={[
                      {
                        id: `${app.id}-status`,
                        icon: 'information-circle',
                        iconColor: app.status === 'active' ? '#34C759' : '#FF9500',
                        title: 'Status',
                        subtitle: app.status === 'active' ? 'Active' : 'Inactive',
                        showChevron: false,
                        customContent: (
                          <Badge
                            label={app.status}
                            variant={app.status === 'active' ? 'success' : 'warning'}
                          />
                        ),
                      },
                      ...(app.description
                        ? [
                          {
                            id: `${app.id}-description`,
                            icon: 'document-text' as keyof typeof Ionicons.glyphMap,
                            iconColor: '#8E8E93',
                            title: 'Description',
                            subtitle: app.description,
                            showChevron: false,
                            multiRow: true,
                          },
                        ]
                        : []),
                      {
                        id: `${app.id}-apikey`,
                        icon: 'key',
                        iconColor: colors.tint,
                        title: 'API Key',
                        subtitle: `${app.apiKey.substring(0, 30)}...`,
                        onPress: () => copyToClipboard(app.apiKey, 'API Key'),
                        showChevron: false,
                        customContent: (
                          <Ionicons name="copy-outline" size={20} color={colors.tint} />
                        ),
                      },
                      {
                        id: `${app.id}-webhook`,
                        icon: 'globe',
                        iconColor: '#007AFF',
                        title: 'Webhook URL',
                        subtitle: app.webhookUrl,
                        showChevron: false,
                        multiRow: true,
                      },
                      ...(app.devWebhookUrl
                        ? [
                          {
                            id: `${app.id}-dev-webhook`,
                            icon: 'code-working' as keyof typeof Ionicons.glyphMap,
                            iconColor: '#FF9500',
                            title: 'Dev Webhook URL',
                            subtitle: app.devWebhookUrl,
                            showChevron: false,
                            multiRow: true,
                          },
                        ]
                        : []),
                      {
                        id: `${app.id}-created`,
                        icon: 'calendar',
                        iconColor: '#5AC8FA',
                        title: 'Created',
                        subtitle: new Date(app.createdAt).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        }),
                        showChevron: false,
                      },
                      {
                        id: `${app.id}-manage`,
                        icon: 'settings',
                        iconColor: colors.tint,
                        title: 'Manage App',
                        subtitle: 'View details, regenerate secret, or delete',
                        onPress: () => router.push(`/app/${app.id}`),
                      },
                    ]}
                  />
                </Section>
              </View>
            ))}
          </View>
        </ScrollView>
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
    gap: 12,
    flex: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  gridContainer: {
    width: '100%',
  },
  gridItem: {
    marginBottom: 0,
  },
  gridItem1Column: {
    width: '100%',
  },
  gridItem2Columns: {
    width: 'calc(50% - 8px)' as any,
  },
  gridItem3Columns: {
    width: 'calc(33.333% - 11px)' as any,
  },
});
