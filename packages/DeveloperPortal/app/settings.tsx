import React, { useState } from 'react';
import { StyleSheet, ScrollView, View, Switch, Text } from 'react-native';
import { ThemedText, ThemedView, Section, GroupedSection } from '@/components';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOxy } from '@oxyhq/services';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toast } from 'sonner-native';

export default function SettingsScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const { user } = useOxy();
  const router = useRouter();
  const [isDarkMode, setIsDarkMode] = useState(colorScheme === 'dark');

  const toggleTheme = async (value: boolean) => {
    setIsDarkMode(value);
    try {
      await AsyncStorage.setItem('theme', value ? 'dark' : 'light');
      toast.success(value ? 'Dark mode enabled' : 'Light mode enabled');
      // Note: In a real app, you'd trigger a theme change here
      // This would typically involve updating a global theme context
    } catch (error) {
      toast.error('Failed to save theme preference');
    }
  };

  return (
    <ThemedView style={styles.container}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
        <View style={[styles.header, { backgroundColor: colors.background }]}>
          <ThemedText type="title">Settings</ThemedText>
        </View>

        {/* Account */}
        {user && (
          <Section title="Account">
            <GroupedSection
              items={[
                {
                  id: 'username',
                  icon: 'person',
                  iconColor: colors.tint,
                  title: 'Username',
                  subtitle: user.username || 'Not set',
                  showChevron: false,
                },
                {
                  id: 'email',
                  icon: 'mail',
                  iconColor: '#007AFF',
                  title: 'Email',
                  subtitle: user.email || 'Not set',
                  showChevron: false,
                },
              ]}
            />
          </Section>
        )}

        {/* Appearance */}
        <Section title="Appearance">
          <GroupedSection
            items={[
              {
                id: 'dark-mode',
                icon: 'moon',
                iconColor: '#5856D6',
                title: 'Dark Mode',
                subtitle: isDarkMode ? 'Enabled' : 'Disabled',
                showChevron: false,
                customContent: (
                  <Switch
                    value={isDarkMode}
                    onValueChange={toggleTheme}
                    trackColor={{ false: '#767577', true: colors.tint }}
                    thumbColor={isDarkMode ? '#f4f3f4' : '#f4f3f4'}
                  />
                ),
              },
            ]}
          />
        </Section>

        {/* Developer */}
        <Section title="Developer">
          <GroupedSection
            items={[
              {
                id: 'api-docs',
                icon: 'document-text',
                iconColor: '#FF9500',
                title: 'API Documentation',
                subtitle: 'View API reference and guides',
                onPress: () => router.push('/(tabs)/explore'),
              },
              {
                id: 'webhook-testing',
                icon: 'code-slash',
                iconColor: '#34C759',
                title: 'Webhook Testing',
                subtitle: 'Test webhook endpoints locally',
                onPress: () => toast.info('Run: node webhook-dev-server.js'),
              },
            ]}
          />
        </Section>

        {/* About */}
        <Section title="About">
          <GroupedSection
            items={[
              {
                id: 'version',
                icon: 'information-circle',
                iconColor: '#8E8E93',
                title: 'Version',
                subtitle: '1.0.0',
                showChevron: false,
              },
              {
                id: 'feedback',
                icon: 'chatbubble',
                iconColor: '#FF3B30',
                title: 'Send Feedback',
                subtitle: 'Help us improve',
                onPress: () => toast.info('Feedback feature coming soon'),
              },
            ]}
          />
        </Section>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingTop: 0,
  },
});
