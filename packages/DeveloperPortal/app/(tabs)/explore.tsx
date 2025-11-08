import { ScrollView, StyleSheet, View, TouchableOpacity, Linking, Platform, TextInput, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { allDocs, externalDocs, getActiveCategories, getDocsByCategory, getDocById, DocPage } from '@/docs';

export default function ExploreScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const { width } = useWindowDimensions();

  const selectedPage = selectedPageId
    ? getDocById(selectedPageId)
    : null;

  const isWeb = Platform.OS === 'web';
  const isMobile = width < 768;
  const isTablet = width >= 768 && width < 1024;

  const handleExternalDocPress = (url: string) => {
    Linking.openURL(url);
  };

  // Get active categories with docs
  const activeCategories = getActiveCategories();

  // Search functionality
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];

    const query = searchQuery.toLowerCase();
    const results: Array<{
      page: DocPage;
      section?: DocPage['content']['sections'][0];
      matchType: 'title' | 'description' | 'content' | 'code';
    }> = [];

    allDocs.forEach(page => {
      // Search in page title
      if (page.title.toLowerCase().includes(query)) {
        results.push({ page, matchType: 'title' });
      }
      // Search in page description
      else if (page.description.toLowerCase().includes(query)) {
        results.push({ page, matchType: 'description' });
      }
      // Search in sections
      else {
        page.content.sections.forEach(section => {
          if (
            section.title.toLowerCase().includes(query) ||
            section.content.toLowerCase().includes(query) ||
            section.code?.toLowerCase().includes(query)
          ) {
            results.push({
              page,
              section,
              matchType: section.code?.toLowerCase().includes(query) ? 'code' : 'content',
            });
          }
        });
      }
    });

    return results;
  }, [searchQuery]);

  // Filtered pages based on search
  const filteredPages = useMemo(() => {
    if (!searchQuery.trim()) return allDocs;
    return Array.from(new Set(searchResults.map(r => r.page)));
  }, [searchQuery, searchResults]);  // Sidebar component
  const Sidebar = () => (
    <View style={[
      styles.sidebar,
      { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F9FA' },
      isMobile && styles.sidebarMobile
    ]}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Search Bar */}
        <View style={[styles.searchContainer, { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#FFFFFF' }]}>
          <Ionicons name="search" size={18} color={colors.icon} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { color: colors.text }]}
            placeholder="Search documentation..."
            placeholderTextColor={colors.icon}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery !== '' && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={colors.icon} />
            </TouchableOpacity>
          )}
        </View>

        {/* Search Results */}
        {searchQuery.trim() !== '' ? (
          <View style={styles.searchResults}>
            <ThemedText style={styles.searchResultsTitle}>
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </ThemedText>
            {searchResults.map((result, index) => (
              <TouchableOpacity
                key={`${result.page.id}-${index}`}
                style={[
                  styles.searchResultItem,
                  { backgroundColor: colorScheme === 'dark' ? '#2C2C2E' : '#FFFFFF' }
                ]}
                onPress={() => {
                  setSelectedPageId(result.page.id);
                  setShowSidebar(false);
                  if (isMobile) setSearchQuery('');
                }}
              >
                <View style={styles.searchResultHeader}>
                  <ThemedText style={styles.searchResultTitle}>{result.page.title}</ThemedText>
                  <View style={[styles.matchTypeBadge, { backgroundColor: colors.tint + '20' }]}>
                    <ThemedText style={[styles.matchTypeText, { color: colors.tint }]}>
                      {result.matchType}
                    </ThemedText>
                  </View>
                </View>
                {result.section && (
                  <ThemedText style={[styles.searchResultSection, { color: colors.icon }]}>
                    {result.section.title}
                  </ThemedText>
                )}
                <ThemedText style={[styles.searchResultDescription, { color: colors.icon }]} numberOfLines={2}>
                  {result.section?.content || result.page.description}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          /* Category Navigation */
          <>
            {activeCategories.map(category => {
              const categoryDocs = getDocsByCategory(category.id);
              const categoryExternalDocs = externalDocs.filter(d => d.category === category.id);

              if (categoryDocs.length === 0 && categoryExternalDocs.length === 0) return null;

              return (
                <View key={category.id} style={styles.sidebarCategory}>
                  <Section title={category.title}>
                    <GroupedSection
                      items={[
                        // Internal docs
                        ...categoryDocs.map(doc => ({
                          id: doc.id,
                          icon: doc.icon,
                          iconColor: doc.iconColor || colors.tint,
                          title: doc.title,
                          subtitle: doc.description,
                          showChevron: true,
                          selected: selectedPageId === doc.id,
                          onPress: () => {
                            setSelectedPageId(doc.id);
                            setShowSidebar(false);
                          },
                        })),
                        // External docs
                        ...categoryExternalDocs.map(doc => ({
                          id: doc.id,
                          icon: doc.icon,
                          iconColor: doc.iconColor || colors.icon,
                          title: doc.title,
                          subtitle: doc.description,
                          showChevron: true,
                          onPress: () => handleExternalDocPress(doc.url),
                        })),
                      ]}
                    />
                  </Section>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );

  // Content component
  const Content = () => {
    if (!selectedPage) {
      return (
        <View style={styles.welcome}>
          <View style={[styles.welcomeIcon, { backgroundColor: colors.tint + '20' }]}>
            <Ionicons name="book" size={64} color={colors.tint} />
          </View>
          <ThemedText type="title" style={styles.welcomeTitle}>
            Oxy API Documentation
          </ThemedText>
          <ThemedText style={[styles.welcomeDescription, { color: colors.icon }]}>
            Build powerful integrations with the Oxy platform
          </ThemedText>
          <View style={styles.welcomeCards}>
            <TouchableOpacity
              style={[styles.welcomeCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
              onPress={() => setSelectedPageId('quick-start')}
            >
              <Ionicons name="rocket" size={32} color={colors.tint} />
              <ThemedText type="subtitle" style={styles.welcomeCardTitle}>Quick Start</ThemedText>
              <ThemedText style={[styles.welcomeCardText, { color: colors.icon }]}>
                Get started in 5 minutes
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.welcomeCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
              onPress={() => setSelectedPageId('authentication')}
            >
              <Ionicons name="key" size={32} color="#FF9500" />
              <ThemedText type="subtitle" style={styles.welcomeCardTitle}>Authentication</ThemedText>
              <ThemedText style={[styles.welcomeCardText, { color: colors.icon }]}>
                Secure your API requests
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.welcomeCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
              onPress={() => setSelectedPageId('webhooks')}
            >
              <Ionicons name="git-branch" size={32} color="#34C759" />
              <ThemedText type="subtitle" style={styles.welcomeCardTitle}>Webhooks</ThemedText>
              <ThemedText style={[styles.welcomeCardText, { color: colors.icon }]}>
                Real-time notifications
              </ThemedText>
            </TouchableOpacity>
          </View>

          {/* Ecosystem Apps Section */}
          <View style={styles.ecosystemSection}>
            <ThemedText type="subtitle" style={styles.ecosystemTitle}>
              Ecosystem Apps
            </ThemedText>
            <ThemedText style={[styles.ecosystemDescription, { color: colors.icon }]}>
              Explore documentation for other Oxy ecosystem applications
            </ThemedText>
            <View style={styles.ecosystemCards}>
              {externalDocs.map(doc => (
                <TouchableOpacity
                  key={doc.id}
                  style={[styles.ecosystemCard, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#FFFFFF' }]}
                  onPress={() => handleExternalDocPress(doc.url)}
                >
                  {doc.icon && (
                    <Ionicons name={doc.icon as any} size={32} color={colors.tint} />
                  )}
                  <View style={styles.ecosystemCardContent}>
                    <ThemedText type="subtitle" style={styles.ecosystemCardTitle}>
                      {doc.title}
                    </ThemedText>
                    <ThemedText style={[styles.ecosystemCardText, { color: colors.icon }]}>
                      {doc.description}
                    </ThemedText>
                  </View>
                  <Ionicons name="open-outline" size={20} color={colors.icon} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      );
    }

    return (
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => setSelectedPageId(null)}>
            <ThemedText style={[styles.breadcrumbText, { color: colors.tint }]}>
              Documentation
            </ThemedText>
          </TouchableOpacity>
          <ThemedText style={[styles.breadcrumbText, { color: colors.icon }]}> / </ThemedText>
          <ThemedText style={styles.breadcrumbText}>{selectedPage.title}</ThemedText>
        </View>

        <ThemedText type="title" style={styles.pageTitle}>{selectedPage.title}</ThemedText>
        <ThemedText style={[styles.pageDescription, { color: colors.icon }]}>
          {selectedPage.description}
        </ThemedText>

        <Card style={styles.contentCard}>
          <ThemedText style={styles.introduction}>
            {selectedPage.content.introduction}
          </ThemedText>

          {selectedPage.content.sections.map((section) => (
            <View key={section.id} style={styles.section}>
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                {section.title}
              </ThemedText>
              <ThemedText style={[styles.sectionContent, { color: colors.text }]}>
                {section.content}
              </ThemedText>

              {section.tip && (
                <View style={[styles.callout, styles.calloutTip, { backgroundColor: '#34C759' + '15', borderLeftColor: '#34C759' }]}>
                  <Ionicons name="bulb" size={20} color="#34C759" style={styles.calloutIcon} />
                  <ThemedText style={styles.calloutText}>{section.tip}</ThemedText>
                </View>
              )}

              {section.warning && (
                <View style={[styles.callout, styles.calloutWarning, { backgroundColor: '#FF9500' + '15', borderLeftColor: '#FF9500' }]}>
                  <Ionicons name="warning" size={20} color="#FF9500" style={styles.calloutIcon} />
                  <ThemedText style={styles.calloutText}>{section.warning}</ThemedText>
                </View>
              )}

              {section.note && (
                <View style={[styles.callout, styles.calloutNote, { backgroundColor: colors.tint + '15', borderLeftColor: colors.tint }]}>
                  <Ionicons name="information-circle" size={20} color={colors.tint} style={styles.calloutIcon} />
                  <ThemedText style={styles.calloutText}>{section.note}</ThemedText>
                </View>
              )}

              {section.code && (
                <View style={[styles.codeBlock, { backgroundColor: colorScheme === 'dark' ? '#000' : '#F5F5F7' }]}>
                  <ThemedText style={[styles.code, { fontFamily: 'monospace' }]}>
                    {section.code}
                  </ThemedText>
                </View>
              )}
            </View>
          ))}
        </Card>

        <View style={styles.pagination}>
          {selectedPageId && allDocs.findIndex(p => p.id === selectedPageId) > 0 && (
            <TouchableOpacity
              style={[styles.paginationButton, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F9FA' }]}
              onPress={() => {
                const currentIndex = allDocs.findIndex(p => p.id === selectedPageId);
                setSelectedPageId(allDocs[currentIndex - 1].id);
              }}
            >
              <Ionicons name="arrow-back" size={20} color={colors.tint} />
              <View style={styles.paginationTextContainer}>
                <ThemedText style={[styles.paginationLabel, { color: colors.icon }]}>Previous</ThemedText>
                <ThemedText style={styles.paginationTitle}>
                  {allDocs[allDocs.findIndex(p => p.id === selectedPageId) - 1].title}
                </ThemedText>
              </View>
            </TouchableOpacity>
          )}
          {selectedPageId && allDocs.findIndex(p => p.id === selectedPageId) < allDocs.length - 1 && (
            <TouchableOpacity
              style={[styles.paginationButton, styles.paginationNext, { backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F8F9FA' }]}
              onPress={() => {
                const currentIndex = allDocs.findIndex(p => p.id === selectedPageId);
                setSelectedPageId(allDocs[currentIndex + 1].id);
              }}
            >
              <View style={styles.paginationTextContainer}>
                <ThemedText style={[styles.paginationLabel, { color: colors.icon }]}>Next</ThemedText>
                <ThemedText style={styles.paginationTitle}>
                  {allDocs[allDocs.findIndex(p => p.id === selectedPageId) + 1].title}
                </ThemedText>
              </View>
              <Ionicons name="arrow-forward" size={20} color={colors.tint} />
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    );
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        {isMobile && (
          <TouchableOpacity onPress={() => setShowSidebar(!showSidebar)}>
            <Ionicons name="menu" size={24} color={colors.text} />
          </TouchableOpacity>
        )}
        <ThemedText type="title">Documentation</ThemedText>
        <UserAvatar size={32} />
      </View>

      <View style={styles.layout}>
        {((isWeb && !isMobile) || showSidebar) && <Sidebar />}
        <View style={styles.main}>
          <Content />
        </View>
      </View>
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
  layout: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 260,
    padding: 16,
    borderRightWidth: 1,
    borderRightColor: '#E5E5E7',
  },
  sidebarMobile: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    zIndex: 1000,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    padding: 0,
  },
  searchResults: {
    marginTop: 8,
  },
  searchResultsTitle: {
    fontSize: 12,
    fontWeight: '600',
    opacity: 0.6,
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  searchResultItem: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  searchResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  searchResultTitle: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  matchTypeBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginLeft: 8,
  },
  matchTypeText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  searchResultSection: {
    fontSize: 12,
    marginBottom: 4,
  },
  searchResultDescription: {
    fontSize: 12,
    lineHeight: 16,
  },
  sidebarCategory: {
    marginBottom: 20,
  },
  categoryTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    opacity: 0.6,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  sidebarItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 2,
  },
  sidebarItemText: {
    fontSize: 14,
  },
  main: {
    flex: 1,
  },
  welcome: {
    padding: 40,
    alignItems: 'center',
  },
  welcomeIcon: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  welcomeTitle: {
    marginBottom: 12,
    textAlign: 'center',
  },
  welcomeDescription: {
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 40,
  },
  welcomeCards: {
    flexDirection: 'row',
    gap: 20,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  welcomeCard: {
    width: 200,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  welcomeCardTitle: {
    marginTop: 16,
    marginBottom: 8,
  },
  welcomeCardText: {
    fontSize: 13,
    textAlign: 'center',
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    padding: 40,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  breadcrumbText: {
    fontSize: 14,
  },
  pageTitle: {
    marginBottom: 8,
  },
  pageDescription: {
    fontSize: 18,
    marginBottom: 32,
  },
  contentCard: {
    padding: 32,
  },
  introduction: {
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 32,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 22,
    marginBottom: 12,
  },
  sectionContent: {
    fontSize: 16,
    lineHeight: 26,
    marginBottom: 16,
  },
  callout: {
    flexDirection: 'row',
    padding: 16,
    borderRadius: 8,
    borderLeftWidth: 4,
    marginVertical: 12,
  },
  calloutTip: {},
  calloutWarning: {},
  calloutNote: {},
  calloutIcon: {
    marginRight: 12,
  },
  calloutText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 22,
  },
  codeBlock: {
    padding: 20,
    borderRadius: 12,
    marginTop: 12,
  },
  code: {
    fontSize: 14,
    lineHeight: 22,
  },
  pagination: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 40,
  },
  paginationButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  paginationNext: {
    justifyContent: 'flex-end',
  },
  paginationTextContainer: {
    flex: 1,
  },
  paginationLabel: {
    fontSize: 12,
    marginBottom: 4,
  },
  paginationTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  externalDocItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  externalDocIcon: {
    marginRight: 4,
  },
  ecosystemSection: {
    marginTop: 48,
    width: '100%',
  },
  ecosystemTitle: {
    marginBottom: 12,
    textAlign: 'center',
  },
  ecosystemDescription: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  ecosystemCards: {
    gap: 16,
  },
  ecosystemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 20,
    borderRadius: 16,
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  ecosystemCardContent: {
    flex: 1,
  },
  ecosystemCardTitle: {
    marginBottom: 4,
  },
  ecosystemCardText: {
    fontSize: 13,
  },
});
