/**
 * Search emails list with Gmail-style search bar.
 * Used by the (search) layout on desktop (always visible) and by the index route on mobile.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { Message } from '@/services/emailApi';
import { MOCK_MESSAGES } from '@/constants/mockData';
import { MessageRow } from '@/components/MessageRow';
import { SearchHeader } from '@/components/SearchHeader';
import { EmptyIllustration } from '@/components/EmptyIllustration';
import { useEmailStore } from '@/hooks/useEmail';

interface SearchListProps {
  /** When true, uses router.replace for message navigation (desktop split-view) */
  replaceNavigation?: boolean;
}

export function SearchList({ replaceNavigation }: SearchListProps) {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const api = useEmailStore((s) => s._api);
  const inputRef = useRef<TextInput>(null);
  const { toggleStar, selectedMessageId } = useEmailStore();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Message[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setHasSearched(true);
    try {
      if (api) {
        const res = await api.search(query.trim());
        setResults(res.data);
      } else if (__DEV__) {
        // Mock search: filter by subject, sender, or body text
        const q = query.trim().toLowerCase();
        const filtered = MOCK_MESSAGES.filter(
          (m) =>
            m.subject.toLowerCase().includes(q) ||
            m.from.name?.toLowerCase().includes(q) ||
            m.from.address.toLowerCase().includes(q) ||
            m.text?.toLowerCase().includes(q),
        );
        setResults(filtered);
      }
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query, api]);

  const handleStar = useCallback(
    async (messageId: string) => {
      try {
        await toggleStar(messageId);
      } catch {}
    },
    [toggleStar],
  );

  const handleMessagePress = useCallback(
    (messageId: string) => {
      const path = replaceNavigation
        ? `/search/conversation/${messageId}`
        : `/search/conversation/${messageId}`;
      if (replaceNavigation) {
        router.replace(path);
      } else {
        router.push(path);
      }
    },
    [router, replaceNavigation],
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
    ({ item }: { item: Message }) => (
      <MessageRow
        message={item}
        onStar={handleStar}
        onSelect={handleMessagePress}
        isSelected={item._id === selectedMessageId}
      />
    ),
    [handleStar, handleMessagePress, selectedMessageId],
  );

  const renderEmpty = useCallback(() => {
    if (searching) return null;
    if (!hasSearched) {
      return (
        <View style={styles.emptyContainer}>
          <EmptyIllustration size={180} />
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            Search your emails
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.emptyContainer}>
        <EmptyIllustration size={180} />
        <Text style={[styles.emptyText, { color: colors.secondaryText }]}>No results found</Text>
      </View>
    );
  }, [searching, hasSearched, colors]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SearchHeader
        ref={inputRef}
        onLeftIcon={handleBack}
        leftIcon="arrow-left"
        placeholder="Search mail"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={handleSearch}
        onClear={handleClear}
        autoFocus
      />

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
