/**
 * Home screen — personalized greeting with AI summary of important emails.
 *
 * Uses full content width (no split-view). Sidebar remains visible on desktop.
 */

import React, { useMemo, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import { Mail01Icon, StarIcon, Attachment01Icon, CheckmarkCircle02Icon } from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useToggleStar } from '@/hooks/mutations/useMessageMutations';
import { useEmailStore } from '@/hooks/useEmail';
import { MessageRow } from '@/components/MessageRow';
import type { Message } from '@/services/emailApi';

/** Mock AI digest — a single summary covering all priority emails */
const AI_DIGEST = `You have 5 emails that need attention. Sarah shared dashboard mockups (v3) and needs your feedback before engineering handoff. Alex's Q1 roadmap is in — your estimates are due Friday. Marcus opened a PR fixing the auth token refresh race condition that needs code review. There's also a failed Vercel deployment on main (auth module) and Emma is waiting on your approval for staging API keys.`;

/** IDs of messages AI considers important (mock) */
const IMPORTANT_IDS = ['msg-1', 'msg-3', 'msg-2', 'msg-5', 'msg-7'];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { user } = useOxy();

  const { data: mailboxes = [] } = useMailboxes();
  const inboxId = mailboxes.find((m) => m.specialUse === 'Inbox')?._id;
  const { data, isLoading } = useMessages(inboxId);
  const toggleStar = useToggleStar();

  const allMessages = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  // Filter to AI-important messages
  const importantMessages = useMemo(() => {
    const idSet = new Set(IMPORTANT_IDS);
    const found = allMessages.filter((m) => idSet.has(m._id));
    // Preserve AI priority order
    found.sort((a, b) => IMPORTANT_IDS.indexOf(a._id) - IMPORTANT_IDS.indexOf(b._id));
    return found;
  }, [allMessages]);

  const handleOpenDrawer = useCallback(() => {
    navigation.dispatch(DrawerActions.openDrawer());
  }, [navigation]);

  const handleMessagePress = useCallback(
    (messageId: string) => {
      useEmailStore.setState({ selectedMessageId: messageId });
      router.push(`/conversation/${messageId}`);
    },
    [router],
  );

  const handleStar = useCallback(
    (messageId: string) => {
      const msg = allMessages.find((m) => m._id === messageId);
      if (msg) toggleStar.mutate({ messageId, starred: !msg.flags.starred });
    },
    [allMessages, toggleStar],
  );

  const firstName = user?.name?.first || user?.username || '';
  const greeting = getGreeting();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — mobile only */}
      {!isDesktop && (
        <View
          style={[
            styles.mobileHeader,
            { borderBottomColor: colors.border, paddingTop: insets.top },
          ]}
        >
          <TouchableOpacity onPress={handleOpenDrawer} style={styles.iconButton}>
            <MaterialCommunityIcons name="menu" size={24} color={colors.icon} />
          </TouchableOpacity>
          <Text style={[styles.mobileHeaderTitle, { color: colors.text }]}>Home</Text>
          <View style={{ width: 40 }} />
        </View>
      )}

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroSection}>
            <Text
              style={[
                styles.greeting,
                { color: colors.text },
                Platform.OS === 'web' && isDesktop && { fontSize: 34 },
              ]}
            >
              {greeting}, {firstName}
            </Text>
            <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
              Here's what needs your attention today.
            </Text>

            {/* Stats row */}
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={Mail01Icon} size={16} color={colors.primary} />
                ) : (
                  <MaterialCommunityIcons name="email-outline" size={16} color={colors.primary} />
                )}
                <Text style={[styles.statText, { color: colors.secondaryText }]}>
                  {allMessages.filter((m) => !m.flags.seen).length} unread
                </Text>
              </View>
              <View style={styles.statItem}>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={StarIcon} size={16} color={colors.starred} />
                ) : (
                  <MaterialCommunityIcons name="star-outline" size={16} color={colors.starred} />
                )}
                <Text style={[styles.statText, { color: colors.secondaryText }]}>
                  {allMessages.filter((m) => m.flags.starred).length} starred
                </Text>
              </View>
              <View style={styles.statItem}>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon icon={Attachment01Icon} size={16} color={colors.secondaryText} />
                ) : (
                  <MaterialCommunityIcons name="paperclip" size={16} color={colors.secondaryText} />
                )}
                <Text style={[styles.statText, { color: colors.secondaryText }]}>
                  {allMessages.filter((m) => m.attachments.length > 0).length} attachments
                </Text>
              </View>
            </View>

            {/* AI Digest */}
            {importantMessages.length > 0 && (
              <Text style={[styles.aiDigestText, { color: colors.text }]}>{AI_DIGEST}</Text>
            )}

            {/* Section title */}
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Priority Emails</Text>
              <Text style={[styles.sectionBadge, { color: colors.secondaryText }]}>
                {importantMessages.length}
              </Text>
            </View>
          </View>

          {/* Grouped emails */}
          {importantMessages.length > 0 ? (
            <View style={[styles.emailGroup, { borderColor: colors.border }]}>
              {importantMessages.map((msg, index) => (
                <React.Fragment key={msg._id}>
                  {index > 0 && (
                    <View style={[styles.separator, { backgroundColor: colors.border }]} />
                  )}
                  <MessageRow
                    message={msg}
                    onStar={handleStar}
                    onSelect={handleMessagePress}
                  />
                </React.Fragment>
              ))}
            </View>
          ) : (
            <View style={styles.emptyContainer}>
              {Platform.OS === 'web' ? (
                <HugeiconsIcon icon={CheckmarkCircle02Icon as unknown as IconSvgElement} size={48} color={colors.success} />
              ) : (
                <MaterialCommunityIcons name="check-circle-outline" size={48} color={colors.success} />
              )}
              <Text style={[styles.emptyTitle, { color: colors.text }]}>All clear</Text>
              <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
                No priority emails right now. Enjoy your day!
              </Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mobileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  mobileHeaderTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    paddingBottom: 40,
    paddingHorizontal: 20,
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%',
  },
  emailGroup: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Hero
  heroSection: {
    paddingTop: '25%',
    paddingBottom: 8,
    width: '100%',
  },
  greeting: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 20,
  },
  // Stats
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statText: {
    fontSize: 15,
  },
  // Section
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  sectionBadge: {
    fontSize: 13,
    fontWeight: '500',
  },
  // AI Digest
  aiDigestText: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
  },
  // Empty
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
    textAlign: 'center',
  },
});
