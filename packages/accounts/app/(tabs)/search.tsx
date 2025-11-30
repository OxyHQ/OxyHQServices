import React, { useMemo, useState, useEffect } from 'react';
import { View, StyleSheet, Platform, useWindowDimensions, TouchableOpacity, TextInput } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { Section } from '@/components/section';
import { GroupedSection } from '@/components/grouped-section';
import { AccountCard } from '@/components/ui';
import { menuItems, type MenuItem } from '@/components/ui/sidebar-content';
import { darkenColor } from '@/utils/color-utils';
import { ScreenContentWrapper } from '@/components/screen-content-wrapper';

export default function SearchScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const { width } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const searchQuery = params.q || '';
  const [localSearchQuery, setLocalSearchQuery] = useState(searchQuery);

  const colors = useMemo(() => Colors[colorScheme], [colorScheme]);
  const isDesktop = useMemo(() => Platform.OS === 'web' && width >= 768, [width]);

  // Sync local state with route params
  useEffect(() => {
    setLocalSearchQuery(searchQuery);
  }, [searchQuery]);

  const handleSearchChange = (text: string) => {
    setLocalSearchQuery(text);
    router.setParams({ q: text || '' });
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) {
      return [];
    }
    const query = searchQuery.toLowerCase();
    return menuItems.filter(item => 
      item.label.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const groupedItems = useMemo(() => {
    return filteredItems.map((item) => {
      const iconColor = colors[item.iconColor as keyof typeof colors] as string;
      return {
        id: item.path,
        icon: item.icon,
        iconColor: iconColor,
        title: item.label,
        onPress: () => router.push(item.path as any),
        showChevron: true,
      };
    });
  }, [filteredItems, colors, router]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {!isDesktop && (
        <View style={[styles.mobileSearchBar, { backgroundColor: colors.card }]}>
          <Ionicons name="search-outline" size={20} color={colors.icon} style={styles.mobileSearchIcon} />
          <TextInput
            style={[styles.mobileSearchInput, { color: colors.text }]}
            placeholder="Search Oxy Account"
            placeholderTextColor={colors.secondaryText}
            value={localSearchQuery}
            onChangeText={handleSearchChange}
            returnKeyType="search"
            autoFocus
          />
        </View>
      )}
      <ScreenContentWrapper>
        <View style={[styles.content, isDesktop && styles.desktopContent]}>
        {!searchQuery.trim() ? (
          <View style={styles.startSearchContainer}>
            <View style={styles.startSearchContent}>
              <MaterialCommunityIcons 
                name="magnify" 
                size={80} 
                color={colors.text} 
                style={styles.startSearchIcon}
              />
              <View style={styles.titleDescriptionWrapper}>
                <ThemedText style={[styles.startSearchTitle, { color: colors.text }]}>Start searching</ThemedText>
                <ThemedText style={[styles.startSearchSubtitle, { color: colors.text }]}>
                  Type in the search bar above to find screens and navigate to different sections of your account.
                </ThemedText>
              </View>
              <View style={styles.suggestionsContainer}>
                <ThemedText style={[styles.suggestionsTitle, { color: colors.text }]}>Try searching for:</ThemedText>
                <View style={styles.suggestionsList}>
                  {menuItems.slice(0, 6).map((item) => {
                    const iconColor = colors[item.iconColor as keyof typeof colors] as string;
                    return (
                      <TouchableOpacity
                        key={item.path}
                        style={[styles.suggestionItem, { backgroundColor: colors.card }]}
                        onPress={() => router.push(item.path as any)}
                        activeOpacity={0.7}
                      >
                        <View style={[styles.suggestionIcon, { backgroundColor: iconColor }]}>
                          <MaterialCommunityIcons name={item.icon as any} size={20} color={darkenColor(iconColor)} />
                        </View>
                        <ThemedText style={[styles.suggestionText, { color: colors.text }]}>{item.label}</ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <ThemedText style={styles.subtitle}>
                {filteredItems.length} {filteredItems.length === 1 ? 'result' : 'results'} for "{searchQuery}"
              </ThemedText>
            </View>
            {filteredItems.length === 0 ? (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons 
              name="magnify" 
              size={48} 
              color={colors.icon} 
              style={styles.emptyIcon}
            />
              <ThemedText style={styles.emptyText}>No results found</ThemedText>
              <ThemedText style={styles.emptySubtext}>
                Try searching for something else
              </ThemedText>
            </View>
          ) : (
            <Section isFirst>
              <AccountCard>
                <GroupedSection items={groupedItems} />
              </AccountCard>
            </Section>
          )}
          </>
        )}
        </View>
      </ScreenContentWrapper>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mobileSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
    gap: 12,
  },
  mobileSearchIcon: {
    opacity: 0.6,
  },
  mobileSearchInput: {
    flex: 1,
    fontSize: 16,
    padding: 0,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 24,
    paddingTop: 0,
  },
  desktopContent: {
    padding: 32,
  },
  header: {
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 8,
    lineHeight: 36,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.6,
    lineHeight: 22,
  },
  startSearchContainer: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'flex-start',
    minHeight: 400,
  },
  startSearchContent: {
    alignItems: 'flex-start',
    width: '100%',
  },
  startSearchIcon: {
    opacity: 0.6,
    marginBottom: 32,
  },
  titleDescriptionWrapper: {
    maxWidth: 600,
    width: '100%',
  },
  startSearchTitle: {
    fontSize: 48,
    fontWeight: '600',
    marginBottom: 24,
    textAlign: 'left',
  },
  startSearchSubtitle: {
    fontSize: 18,
    opacity: 0.7,
    textAlign: 'left',
    marginBottom: 48,
    lineHeight: 26,
  },
  suggestionsContainer: {
    width: '100%',
    alignItems: 'flex-start',
  },
  suggestionsTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 16,
    opacity: 0.8,
  },
  suggestionsList: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 999,
    gap: 8,
  },
  suggestionIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionText: {
    fontSize: 15,
    opacity: 0.8,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 120,
    paddingHorizontal: 24,
  },
  emptyIcon: {
    opacity: 0.5,
    marginBottom: 24,
  },
  emptyText: {
    fontSize: 32,
    fontWeight: '600',
    marginBottom: 12,
    opacity: 0.9,
  },
  emptySubtext: {
    fontSize: 18,
    opacity: 0.7,
    textAlign: 'center',
  },
});

