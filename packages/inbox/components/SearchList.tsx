/**
 * Search emails list with Gmail-style search bar and filter chips.
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import type { Message } from '@/services/emailApi';
import { MessageRow } from '@/components/MessageRow';
import { SearchHeader } from '@/components/SearchHeader';
import { EmptyIllustration } from '@/components/EmptyIllustration';
import { useEmailStore } from '@/hooks/useEmail';
import { useSearchMessages } from '@/hooks/queries/useSearchMessages';
import { useToggleStar } from '@/hooks/mutations/useMessageMutations';
import { useMailboxes } from '@/hooks/queries/useMailboxes';

/**
 * Parse Gmail-style search operators from query string.
 * Supported operators:
 * - in:inbox, in:sent, in:spam, in:trash, in:drafts, in:archive, in:starred
 * - is:starred, is:unread, is:read
 * - from:address
 * - has:attachment
 * - label:name
 */
interface ParsedQuery {
  text: string;
  mailbox?: string;
  starred?: boolean;
  unread?: boolean;
  from?: string;
  hasAttachment?: boolean;
  label?: string;
}

function parseSearchQuery(query: string): ParsedQuery {
  const result: ParsedQuery = { text: '' };
  const textParts: string[] = [];

  // Split by spaces but keep quoted strings together
  const tokens = query.match(/(?:[^\s"]+|"[^"]*")+/g) || [];

  for (const token of tokens) {
    const lower = token.toLowerCase();

    if (lower.startsWith('in:')) {
      const value = token.slice(3).toLowerCase();
      if (value === 'starred') {
        result.starred = true;
      } else {
        result.mailbox = value;
      }
    } else if (lower.startsWith('is:')) {
      const value = token.slice(3).toLowerCase();
      if (value === 'starred') result.starred = true;
      else if (value === 'unread') result.unread = true;
      else if (value === 'read') result.unread = false;
    } else if (lower.startsWith('from:')) {
      result.from = token.slice(5).replace(/^"|"$/g, '');
    } else if (lower === 'has:attachment') {
      result.hasAttachment = true;
    } else if (lower.startsWith('label:')) {
      result.label = token.slice(6).replace(/^"|"$/g, '');
    } else {
      // Regular search text
      textParts.push(token.replace(/^"|"$/g, ''));
    }
  }

  result.text = textParts.join(' ');
  return result;
}

interface SearchListProps {
  replaceNavigation?: boolean;
}

export function SearchList({ replaceNavigation }: SearchListProps) {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const inputRef = useRef<TextInput>(null);
  const selectedMessageId = useEmailStore((s) => s.selectedMessageId);
  const toggleStar = useToggleStar();
  const { data: mailboxes = [] } = useMailboxes();

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterHasAttachment, setFilterHasAttachment] = useState(false);
  const [editingFilter, setEditingFilter] = useState<string | null>(null);
  const [filterInput, setFilterInput] = useState('');

  // Parse the submitted query for Gmail-style operators
  const parsedQuery = useMemo(() => parseSearchQuery(submittedQuery), [submittedQuery]);

  // Map mailbox name to mailbox ID
  const mailboxIdFromName = useMemo(() => {
    if (!parsedQuery.mailbox) return undefined;
    const specialUseMap: Record<string, string> = {
      inbox: '\\Inbox',
      sent: '\\Sent',
      drafts: '\\Drafts',
      trash: '\\Trash',
      spam: '\\Junk',
      junk: '\\Junk',
      archive: '\\Archive',
    };
    const specialUse = specialUseMap[parsedQuery.mailbox];
    if (specialUse) {
      const mailbox = mailboxes.find((m) => m.specialUse === specialUse);
      return mailbox?._id;
    }
    // Try to match by name
    const mailbox = mailboxes.find((m) => m.name.toLowerCase() === parsedQuery.mailbox);
    return mailbox?._id;
  }, [parsedQuery.mailbox, mailboxes]);

  const searchOptions = useMemo(() => ({
    q: parsedQuery.text || undefined,
    from: parsedQuery.from || filterFrom || undefined,
    hasAttachment: parsedQuery.hasAttachment || filterHasAttachment || undefined,
    mailbox: mailboxIdFromName,
    // Note: starred/label/unread filters would need backend support
  }), [parsedQuery, filterFrom, filterHasAttachment, mailboxIdFromName]);

  const { data: searchResult, isLoading: searching } = useSearchMessages(searchOptions);
  const results = searchResult?.data ?? [];
  const total = searchResult?.pagination?.total ?? 0;
  const hasSearched = !!(submittedQuery.trim() || filterFrom || filterHasAttachment || mailboxIdFromName);

  const handleSearch = useCallback(() => {
    // Allow submitting with just operators (e.g., "in:spam") even if no plain text
    setSubmittedQuery(query);
  }, [query]);

  const handleStar = useCallback(
    (messageId: string) => {
      const msg = results.find((m) => m._id === messageId);
      if (msg) toggleStar.mutate({ messageId, starred: !msg.flags.starred });
    },
    [results, toggleStar],
  );

  const handleMessagePress = useCallback(
    (messageId: string) => {
      const path = `/search/conversation/${messageId}` as any;
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
    setSubmittedQuery('');
    setFilterFrom('');
    setFilterHasAttachment(false);
    inputRef.current?.focus();
  }, []);

  const handleFilterChipPress = useCallback((filter: string) => {
    if (filter === 'attachment') {
      setFilterHasAttachment((v) => !v);
    } else {
      setEditingFilter(filter);
      setFilterInput(filter === 'from' ? filterFrom : '');
    }
  }, [filterFrom]);

  const handleFilterSubmit = useCallback(() => {
    if (editingFilter === 'from') {
      setFilterFrom(filterInput.trim());
    }
    setEditingFilter(null);
    setFilterInput('');
  }, [editingFilter, filterInput]);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageRow
        message={item}
        onStar={handleStar}
        onSelect={handleMessagePress}
        isSelected={item._id === selectedMessageId}
        isStarPending={toggleStar.isPending && toggleStar.variables?.messageId === item._id}
      />
    ),
    [handleStar, handleMessagePress, selectedMessageId, toggleStar.isPending, toggleStar.variables?.messageId],
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

      {/* Filter chips */}
      <View style={styles.filterBar}>
        <TouchableOpacity
          style={[
            styles.filterChip,
            { borderColor: colors.border },
            filterFrom ? { backgroundColor: colors.primary + '15', borderColor: colors.primary } : undefined,
          ]}
          onPress={() => handleFilterChipPress('from')}
          activeOpacity={0.7}
        >
          <Text style={[styles.filterChipText, { color: filterFrom ? colors.primary : colors.secondaryText }]}>
            {filterFrom ? `From: ${filterFrom}` : 'From'}
          </Text>
          {filterFrom ? (
            <TouchableOpacity onPress={() => setFilterFrom('')} hitSlop={4}>
              <MaterialCommunityIcons name="close-circle" size={14} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.filterChip,
            { borderColor: colors.border },
            filterHasAttachment ? { backgroundColor: colors.primary + '15', borderColor: colors.primary } : undefined,
          ]}
          onPress={() => handleFilterChipPress('attachment')}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons
            name="paperclip"
            size={14}
            color={filterHasAttachment ? colors.primary : colors.secondaryText}
          />
          <Text style={[styles.filterChipText, { color: filterHasAttachment ? colors.primary : colors.secondaryText }]}>
            Has attachment
          </Text>
        </TouchableOpacity>
      </View>

      {/* Filter input overlay */}
      {editingFilter && (
        <View style={[styles.filterInputRow, { backgroundColor: colors.surfaceVariant }]}>
          <Text style={[styles.filterInputLabel, { color: colors.secondaryText }]}>
            {editingFilter === 'from' ? 'From:' : editingFilter}
          </Text>
          <TextInput
            style={[styles.filterInputField, { color: colors.text }]}
            value={filterInput}
            onChangeText={setFilterInput}
            autoFocus
            onSubmitEditing={handleFilterSubmit}
            returnKeyType="done"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TouchableOpacity onPress={() => setEditingFilter(null)}>
            <MaterialCommunityIcons name="close" size={20} color={colors.icon} />
          </TouchableOpacity>
        </View>
      )}

      {/* Result count */}
      {hasSearched && !searching && results.length > 0 && (
        <View style={styles.resultCount}>
          <Text style={[styles.resultCountText, { color: colors.secondaryText }]}>
            {total} {total === 1 ? 'result' : 'results'}
          </Text>
        </View>
      )}

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
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
    flexWrap: 'wrap',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  filterInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  filterInputLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  filterInputField: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 4,
  },
  resultCount: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  resultCountText: {
    fontSize: 12,
    fontWeight: '500',
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
