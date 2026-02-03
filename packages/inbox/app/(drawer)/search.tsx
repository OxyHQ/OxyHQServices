/**
 * Search emails screen with Gmail-style search bar.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { emailApi, type Message } from '@/services/emailApi';
import { MessageRow } from '@/components/MessageRow';
import { useEmailStore } from '@/hooks/useEmail';

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const { oxyServices } = useOxy();
  const inputRef = useRef<TextInput>(null);
  const { toggleStar } = useEmailStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setHasSearched(true);
    try {
      const token = oxyServices.httpService.getAccessToken();
      if (!token) return;
      const res = await emailApi.search(token, query.trim());
      setResults(res.data);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query, oxyServices]);

  const handleStar = useCallback(
    async (messageId: string) => {
      try {
        const token = oxyServices.httpService.getAccessToken();
        if (token) await toggleStar(token, messageId);
      } catch {}
    },
    [oxyServices, toggleStar],
  );

  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleClear = useCallback(() => {
    setQuery('');
    setResults([]);
    setHasSearched(false);
    inputRef.current?.focus();
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => <MessageRow message={item} onStar={handleStar} />,
    [handleStar],
  );

  const renderEmpty = useCallback(() => {
    if (searching) return null;
    if (!hasSearched) {
      return (
        <View style={styles.emptyContainer}>
          <MaterialCommunityIcons name="magnify" size={64} color={colors.secondaryText} />
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            Search your emails
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <MaterialCommunityIcons name="email-search-outline" size={64} color={colors.secondaryText} />
        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No results found</Text>
      </View>
    );
  }, [searching, hasSearched, colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Search bar */}
      <View style={[styles.searchBar, { paddingTop: insets.top + 8, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={handleBack} style={styles.iconButton}>
          <MaterialCommunityIcons name="arrow-left" size={24} color={colors.icon} />
        </TouchableOpacity>
        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.searchText, backgroundColor: colors.searchBackground }]}
          value={query}
          onChangeText={setQuery}
          placeholder="Search mail"
          placeholderTextColor={colors.searchPlaceholder}
          returnKeyType="search"
          onSubmitEditing={handleSearch}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={handleClear} style={styles.iconButton}>
            <MaterialCommunityIcons name="close" size={20} color={colors.icon} />
          </TouchableOpacity>
        )}
      </View>

      {searching && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      <FlatList
        data={results}
        renderItem={renderItem}
        keyExtractor={(item) => item._id}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={results.length === 0 ? styles.emptyListContent : undefined}
        showsVerticalScrollIndicator={false}
        ItemSeparatorComponent={() => (
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  iconButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  input: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  loadingContainer: {
    paddingTop: 40,
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 120,
    gap: 12,
  },
  emptyText: {
    fontSize: 16,
  },
  emptyListContent: {
    flexGrow: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },
});
