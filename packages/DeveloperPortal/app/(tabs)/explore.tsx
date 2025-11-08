import { ScrollView, StyleSheet, View, TouchableOpacity, Linking } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';

interface DocSection {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  link?: string;
}

const docSections: DocSection[] = [
  {
    icon: 'rocket-outline',
    title: 'Getting Started',
    description: 'Learn how to authenticate and make your first API request',
    link: 'https://docs.oxy.com/getting-started',
  },
  {
    icon: 'key-outline',
    title: 'Authentication',
    description: 'Use API keys and secrets to authenticate your requests',
    link: 'https://docs.oxy.com/authentication',
  },
  {
    icon: 'git-branch-outline',
    title: 'Webhooks',
    description: 'Receive real-time notifications for file events',
    link: 'https://docs.oxy.com/webhooks',
  },
  {
    icon: 'cloud-upload-outline',
    title: 'File API',
    description: 'Upload, manage, and share files via the API',
    link: 'https://docs.oxy.com/files',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'Security',
    description: 'Best practices for keeping your API credentials safe',
    link: 'https://docs.oxy.com/security',
  },
  {
    icon: 'code-slash-outline',
    title: 'API Reference',
    description: 'Complete documentation of all endpoints and parameters',
    link: 'https://docs.oxy.com/api-reference',
  },
];

export default function ExploreScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];

  const openLink = (url?: string) => {
    if (url) {
      Linking.openURL(url);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title">Documentation</ThemedText>
        <UserAvatar />
      </View>

      <ScrollView 
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={[styles.heroIcon, { backgroundColor: colors.tint + '20' }]}>
            <Ionicons name="book" size={48} color={colors.tint} />
          </View>
          <ThemedText type="title" style={styles.heroTitle}>
            Developer Resources
          </ThemedText>
          <ThemedText style={[styles.heroDescription, { color: colors.icon }]}>
            Everything you need to integrate with the Oxy API
          </ThemedText>
        </View>

        <View style={styles.sectionsContainer}>
          {docSections.map((section, index) => (
            <TouchableOpacity
              key={index}
              style={[
                styles.sectionCard,
                { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }
              ]}
              onPress={() => openLink(section.link)}
              activeOpacity={0.7}
            >
              <View style={[styles.sectionIcon, { backgroundColor: colors.tint + '15' }]}>
                <Ionicons name={section.icon} size={24} color={colors.tint} />
              </View>
              <View style={styles.sectionContent}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  {section.title}
                </ThemedText>
                <ThemedText style={[styles.sectionDescription, { color: colors.icon }]}>
                  {section.description}
                </ThemedText>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.icon} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={[styles.quickLinksCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F9FA' }]}>
          <ThemedText type="subtitle" style={styles.quickLinksTitle}>
            Quick Links
          </ThemedText>
          <View style={styles.quickLinksGrid}>
            <TouchableOpacity style={styles.quickLink}>
              <Ionicons name="logo-github" size={20} color={colors.tint} />
              <ThemedText style={styles.quickLinkText}>GitHub</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickLink}>
              <Ionicons name="chatbubbles" size={20} color={colors.tint} />
              <ThemedText style={styles.quickLinkText}>Discord</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickLink}>
              <Ionicons name="help-circle" size={20} color={colors.tint} />
              <ThemedText style={styles.quickLinkText}>Support</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickLink}>
              <Ionicons name="newspaper" size={20} color={colors.tint} />
              <ThemedText style={styles.quickLinkText}>Blog</ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.footer}>
          <ThemedText style={[styles.footerText, { color: colors.icon }]}>
            Oxy Developer Portal • v1.0.0
          </ThemedText>
        </View>
      </ScrollView>
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
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  heroIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  heroTitle: {
    marginBottom: 12,
  },
  heroDescription: {
    fontSize: 16,
    textAlign: 'center',
    maxWidth: 280,
  },
  sectionsContainer: {
    gap: 12,
    marginBottom: 24,
  },
  sectionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 16,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  sectionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionContent: {
    flex: 1,
  },
  sectionTitle: {
    marginBottom: 4,
    fontSize: 16,
  },
  sectionDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  quickLinksCard: {
    padding: 20,
    borderRadius: 16,
    marginBottom: 24,
  },
  quickLinksTitle: {
    marginBottom: 16,
  },
  quickLinksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  quickLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(0, 122, 255, 0.1)',
    borderRadius: 10,
  },
  quickLinkText: {
    fontSize: 14,
    fontWeight: '600',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  footerText: {
    fontSize: 12,
  },
});
