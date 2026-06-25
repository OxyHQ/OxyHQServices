/**
 * Home screen — personalized greeting with AI summary of important emails.
 *
 * The hero uses the wheat-field photo as a full-bleed background. A
 * `LinearGradient` overlay (darker at the top so the system clock + week
 * header stay readable, fading toward transparent over the content) sits on
 * top of the photo. While focused the status bar is forced to `light` style
 * so the system clock contrasts with the photo. Cards on top use Bloom's
 * background so they stay theme-aware in dark mode.
 */

import React, { useMemo, useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ImageBackground,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Loading } from '@oxyhq/bloom/loading';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowUp01Icon,
  ArrowDown01Icon,
  Menu01Icon,
  Mail01Icon,
  StarIcon,
  Attachment01Icon,
} from '@hugeicons/core-free-icons';

import { useTheme } from '@oxyhq/bloom/theme';
import { Divider } from '@oxyhq/bloom/divider';
import { Badge } from '@oxyhq/bloom/badge';
import { useColors } from '@/constants/theme';
import { SPECIAL_USE } from '@/constants/mailbox';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useLabels } from '@/hooks/queries/useLabels';
import { useToggleStar } from '@/hooks/mutations/useMessageMutations';
import { useEmailStore } from '@/hooks/useEmail';
import { MessageRow } from '@/components/MessageRow';
import { LogoIcon } from '@/assets/logo';
import { useDailyBrief } from '@/hooks/queries/useDailyBrief';
import { useNeedsResponse } from '@/hooks/queries/useNeedsResponse';
import { useFollowUp } from '@/hooks/queries/useFollowUp';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function getWeekDays(selectedDate: Date) {
  const day = selectedDate.getDay();
  const start = new Date(selectedDate);
  start.setDate(start.getDate() - day);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear()
  );
}

interface DrawerNavigation {
  openDrawer?: () => void;
  dispatch?: (action: unknown) => void;
}

export function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation<DrawerNavigation>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colors = useColors();
  const { mode } = useTheme();
  const isDark = mode === 'dark';
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { user, isAuthenticated } = useOxy();

  // `realToday` is intentionally a piece of state — it's refreshed on focus
  // (see `useFocusEffect` below) so the home screen self-heals after the date
  // rolls over without the user backgrounding the app.
  const [realToday, setRealToday] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [needsResponseExpanded, setNeedsResponseExpanded] = useState(true);
  const [followUpExpanded, setFollowUpExpanded] = useState(true);

  // Recompute `realToday` / `selectedDate` whenever the screen regains focus.
  // This catches the day-rollover case where the user left the app open
  // across midnight and returns to a stale "today" pinned to yesterday.
  useFocusEffect(
    useCallback(() => {
      const now = new Date();
      setRealToday((prev) => (isSameDay(prev, now) ? prev : now));
      setSelectedDate((prev) => (isSameDay(prev, now) ? prev : now));
    }, []),
  );

  const isOnToday = isSameDay(selectedDate, realToday);

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);

  const { data: mailboxes = [] } = useMailboxes();
  const { data: labels = [] } = useLabels();
  const labelColorMap = useMemo(() => {
    const map = new Map<string, string>();
    labels.forEach((l) => map.set(l.name, l.color));
    return map;
  }, [labels]);
  const inboxId = mailboxes.find((m) => m.specialUse === SPECIAL_USE.INBOX)?._id;
  const { data, isLoading } = useMessages(inboxId ? { mailboxId: inboxId } : {});
  const toggleStar = useToggleStar();

  const allMessages = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  // Stats — filtered by selected date
  const dayMessages = useMemo(
    () => allMessages.filter((m) => isSameDay(new Date(m.date), selectedDate)),
    [allMessages, selectedDate]
  );
  const unreadCount = useMemo(() => dayMessages.filter((m) => !m.flags.seen).length, [dayMessages]);
  const starredCount = useMemo(() => dayMessages.filter((m) => m.flags.starred).length, [dayMessages]);
  const attachmentCount = useMemo(() => dayMessages.filter((m) => m.attachments.length > 0).length, [dayMessages]);

  const handleOpenDrawer = useCallback(() => {
    // Synthesize the DrawerActions.openDrawer payload inline — expo-router v56
    // rejects direct `@react-navigation/*` imports.
    if (navigation.openDrawer) {
      navigation.openDrawer();
      return;
    }
    navigation.dispatch?.({ type: 'OPEN_DRAWER' });
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

  // Greeting name: render the API's canonical `name.displayName` directly — do
  // not recompose from `name.first` / `name.last` / `username` (display-name
  // contract). Empty string when signed-out / not yet loaded.
  const greetingName = user?.name.displayName ?? '';

  // AI daily brief — uses messages from selected date
  const { briefText, isStreaming: briefStreaming, isLoading: briefLoading, error: briefError, regenerate } = useDailyBrief(dayMessages, greetingName);

  // AI-powered sections: emails needing response and follow-up
  const { messages: needsResponseMessages, count: needsResponseCount } = useNeedsResponse(allMessages, 5);
  const { messages: followUpMessages, count: followUpCount, isLoading: followUpLoading } = useFollowUp(allMessages, 5);

  // Greeting respects empty user (signed-out / not loaded yet) — no dangling comma.
  const greetingBase = getGreeting();
  const greetingLine = greetingName ? `${greetingBase}, ${greetingName}` : greetingBase;
  // Long-form, locale-aware date — "May 24, 2026" — used as the single header
  // above the week strip. Computed via Intl.DateTimeFormat so it follows the
  // user's system locale conventions rather than a hard-coded MONTHS array.
  const longDate = useMemo(
    () => new Intl.DateTimeFormat('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(selectedDate),
    [selectedDate],
  );

  return (
    <ImageBackground
      source={require('@/assets/images/home.jpg')}
      style={styles.container}
      resizeMode="cover"
    >
      <StatusBar style="light" />

      {/*
       * Two-stop overlay: a strong dark wash over the top portion (status bar
       * + header + week strip) so the system clock, week labels, and date
       * header stay legible over the photo; then fade to a softer overlay so
       * the photo still reads in the lower portion. A second subtle full-bleed
       * scrim handles dark mode (deeper) vs light mode.
       */}
      <View style={[styles.overlay, isDark && styles.overlayDark]} />
      <LinearGradient
        colors={[
          isDark ? 'rgba(0,0,0,0.75)' : 'rgba(0,0,0,0.55)',
          isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)',
          'rgba(0,0,0,0)',
        ]}
        locations={[0, 0.45, 1]}
        style={styles.topGradient}
        pointerEvents="none"
      />

      {/* Header bar — left: drawer menu, center: logo, right: optional
          "jump to today" button when the selected date drifts away from
          actual today. */}
      <View style={[styles.header, { paddingTop: isDesktop ? 16 : insets.top + 8 }]}>
        {!isDesktop && (
          <TouchableOpacity
            onPress={handleOpenDrawer}
            style={styles.headerButton}
            accessibilityLabel="Open menu"
            accessibilityRole="button"
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={Menu01Icon as unknown as IconSvgElement} size={24} color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons name="menu" size={24} color="#FFFFFF" />
            )}
          </TouchableOpacity>
        )}
        <LogoIcon height={24} color="#FFFFFF" />
        <View style={{ flex: 1 }} />
        {!isOnToday && (
          <TouchableOpacity
            onPress={() => setSelectedDate(new Date())}
            style={styles.headerButton}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            activeOpacity={0.7}
            accessibilityLabel="Jump to today"
            accessibilityRole="button"
          >
            <MaterialCommunityIcons name="calendar-today" size={22} color="#FFFFFF" />
          </TouchableOpacity>
        )}
      </View>

      {/*
       * Single FlashList that drives the whole screen:
       *  - `ListHeaderComponent` carries the brief title, week strip,
       *    greeting, stats, AI brief, Needs Response, and Follow Up
       *    blocks (i.e. the "summary").
       *  - Items are inbox messages (`allMessages`) so the home screen
       *    doubles as the user's main inbox feed. Tapping a row navigates
       *    to the conversation detail just like InboxList does.
       *  - `ListEmptyComponent` covers the signed-in-but-no-messages
       *    case. The signed-out variant is handled by `ListHeaderComponent`
       *    rendering the sign-in card instead of the summary.
       */}
      <FlashList
        data={isAuthenticated ? allMessages : []}
        keyExtractor={(msg) => msg._id}
        contentContainerStyle={{
          ...styles.scrollContent,
          // NativeTabs already adds the safe-area bottom inset on Android,
          // so doubling it here would over-pad. iOS / web apply the inset
          // explicitly. Landscape: include left/right inset so content
          // clears the notch instead of hugging the screen edge.
          paddingBottom: Platform.OS === 'android' ? 40 : insets.bottom + 40,
          paddingHorizontal: 20 + Math.max(insets.left, insets.right),
        }}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => (
          <View style={[styles.feedRow, { backgroundColor: colors.background }]}>
            <MessageRow
              message={item}
              onStar={handleStar}
              onSelect={handleMessagePress}
              labelColorMap={labelColorMap}
            />
          </View>
        )}
        ListHeaderComponent={
          <>
            {/* Single header above the week strip — replaces the old "May 2026"
                month label. Reads "Today's Brief - May 24, 2026" so the date
                and section name are surfaced in one line. */}
            <Text style={styles.briefTitle}>
              <Text style={styles.briefTitleItalic}>Today's Brief</Text>
              {' - '}
              {longDate}
            </Text>
            <View style={styles.weekStripRow}>
              <TouchableOpacity
                accessibilityLabel="Previous week"
                accessibilityRole="button"
                onPress={() => setSelectedDate((d) => {
                  const prev = new Date(d);
                  prev.setDate(prev.getDate() - 7);
                  return prev;
                })}
                style={styles.weekArrow}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="chevron-left" size={20} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
              <View style={styles.weekStrip}>
                {weekDays.map((d, i) => {
                  const isSelected = isSameDay(d, selectedDate);
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[styles.dayCell, isSelected && styles.dayCellActive]}
                      onPress={() => setSelectedDate(new Date(d))}
                      activeOpacity={0.7}
                      accessibilityLabel={`${DAYS[d.getDay()]} ${d.getDate()}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                    >
                      <Text style={[styles.dayLabel, isSelected && styles.dayLabelActive]}>
                        {DAYS[d.getDay()]}
                      </Text>
                      <Text style={[styles.dayNumber, isSelected && styles.dayNumberActive]}>
                        {String(d.getDate()).padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                accessibilityLabel="Next week"
                accessibilityRole="button"
                onPress={() => setSelectedDate((d) => {
                  const next = new Date(d);
                  next.setDate(next.getDate() + 7);
                  return next;
                })}
                style={styles.weekArrow}
                activeOpacity={0.7}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />
              </TouchableOpacity>
            </View>

            {!isAuthenticated ? (
              /*
               * Signed-out variant — render flush against the photo overlay
               * (no card chrome). Greeting + CTA copy + sign-in button on
               * the wheat-field background. No message feed below.
               */
              <View style={styles.summaryBlock}>
                <Text style={[styles.summaryGreeting, styles.overlayTextShadow]}>
                  {greetingLine}
                </Text>
                <Text style={[styles.summaryBriefText, styles.signedOutText, styles.overlayTextShadow]}>
                  Sign in to see your daily brief, emails that need a reply, and
                  follow-ups waiting on you.
                </Text>
                <View style={styles.signedOutCtaWrapper}>
                  <OxySignInButton variant="contained" />
                </View>
              </View>
            ) : (
              <>
                {/*
                 * Summary / AI brief block — renders FLUSH against the photo
                 * background (no card wrapper, no rounded panel, no shadow).
                 */}
                <View style={styles.summaryBlock}>
                  <Text style={[styles.summaryGreeting, styles.overlayTextShadow]}>
                    {greetingLine}
                  </Text>

                  {/* Stats row — pills stay tinted so they read on the photo */}
                  <View style={styles.statsRow}>
                    <View style={[styles.statPill, { backgroundColor: colors.primaryContainer }]}>
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon icon={Mail01Icon as unknown as IconSvgElement} size={14} color={colors.primary} />
                      ) : (
                        <MaterialCommunityIcons name="email-outline" size={14} color={colors.primary} />
                      )}
                      <Text style={[styles.statText, { color: colors.primary }]}>
                        {unreadCount} unread
                      </Text>
                    </View>
                    <View style={[styles.statPill, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon icon={StarIcon as unknown as IconSvgElement} size={14} color={colors.starred} />
                      ) : (
                        <MaterialCommunityIcons name="star" size={14} color={colors.starred} />
                      )}
                      <Text style={[styles.statText, { color: colors.starred }]}>
                        {starredCount} starred
                      </Text>
                    </View>
                    <View style={[styles.statPill, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon icon={Attachment01Icon as unknown as IconSvgElement} size={14} color="#FFFFFF" />
                      ) : (
                        <MaterialCommunityIcons name="paperclip" size={14} color="#FFFFFF" />
                      )}
                      <Text style={[styles.statText, { color: '#FFFFFF' }]}>
                        {attachmentCount}
                      </Text>
                    </View>
                  </View>

                  {briefLoading ? (
                    <View style={styles.briefLoadingRow}>
                      <Loading variant="inline" size="small" />
                      <Text style={[styles.summaryBriefText, styles.overlayTextShadow]}>
                        Alia is analyzing your inbox...
                      </Text>
                    </View>
                  ) : briefError && !briefText ? (
                    <Text style={[styles.summaryBriefText, styles.overlayTextShadow]}>
                      Unable to generate brief right now.
                    </Text>
                  ) : briefText ? (
                    <Text style={[styles.summaryBriefText, styles.overlayTextShadow]}>
                      {briefText}
                      {briefStreaming && <Text style={styles.summaryBriefCursor}>|</Text>}
                    </Text>
                  ) : (
                    <Text style={[styles.summaryBriefText, styles.overlayTextShadow]}>
                      No emails to summarize yet.
                    </Text>
                  )}
                  <TouchableOpacity
                    onPress={regenerate}
                    style={styles.refreshButton}
                    activeOpacity={0.7}
                    accessibilityLabel="Regenerate brief"
                    accessibilityRole="button"
                  >
                    <MaterialCommunityIcons name="refresh" size={16} color="rgba(255,255,255,0.85)" />
                  </TouchableOpacity>
                </View>

                {/* Needs Response — card-styled sub-content panel. */}
                {needsResponseMessages.length > 0 && (
                  <View style={[styles.card, { backgroundColor: colors.background }]}>
                    <TouchableOpacity
                      style={styles.sectionHeader}
                      onPress={() => setNeedsResponseExpanded((v) => !v)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Needs response, ${needsResponseCount} email${needsResponseCount === 1 ? '' : 's'}`}
                      accessibilityState={{ expanded: needsResponseExpanded }}
                    >
                      <View style={styles.sectionHeaderLeft}>
                        <MaterialCommunityIcons name="message-reply-text-outline" size={18} color={colors.primary} />
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>
                          Needs Response
                        </Text>
                        <Badge variant="subtle" color="primary" content={needsResponseCount} size="small" />
                      </View>
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon
                          icon={(needsResponseExpanded ? ArrowUp01Icon : ArrowDown01Icon) as unknown as IconSvgElement}
                          size={20}
                          color={colors.secondaryText}
                        />
                      ) : (
                        <MaterialCommunityIcons
                          name={needsResponseExpanded ? 'chevron-up' : 'chevron-down'}
                          size={20}
                          color={colors.secondaryText}
                        />
                      )}
                    </TouchableOpacity>

                    {needsResponseExpanded && (
                      <>
                        {needsResponseMessages.map((msg, index) => (
                          <React.Fragment key={msg._id}>
                            {index > 0 && (
                               <Divider />
                            )}
                            <MessageRow
                              message={msg}
                              onStar={handleStar}
                              onSelect={handleMessagePress}
                              labelColorMap={labelColorMap}
                            />
                          </React.Fragment>
                        ))}
                      </>
                    )}
                  </View>
                )}

                {/* Follow Up — card-styled sub-content panel. */}
                {followUpMessages.length > 0 && (
                  <View style={[styles.card, { backgroundColor: colors.background }]}>
                    <TouchableOpacity
                      style={styles.sectionHeader}
                      onPress={() => setFollowUpExpanded((v) => !v)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Follow up, ${followUpCount} email${followUpCount === 1 ? '' : 's'}`}
                      accessibilityState={{ expanded: followUpExpanded }}
                    >
                      <View style={styles.sectionHeaderLeft}>
                        <MaterialCommunityIcons name="clock-outline" size={18} color={colors.starred} />
                        <Text style={[styles.sectionTitle, { color: colors.text }]}>
                          Follow Up
                        </Text>
                        <Badge variant="subtle" color="warning" content={followUpCount} size="small" />
                      </View>
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon
                          icon={(followUpExpanded ? ArrowUp01Icon : ArrowDown01Icon) as unknown as IconSvgElement}
                          size={20}
                          color={colors.secondaryText}
                        />
                      ) : (
                        <MaterialCommunityIcons
                          name={followUpExpanded ? 'chevron-up' : 'chevron-down'}
                          size={20}
                          color={colors.secondaryText}
                        />
                      )}
                    </TouchableOpacity>

                    {followUpExpanded && (
                      <>
                        {followUpMessages.map((msg, index) => (
                          <React.Fragment key={msg._id}>
                            {index > 0 && (
                               <Divider />
                            )}
                            <MessageRow
                              message={msg}
                              onStar={handleStar}
                              onSelect={handleMessagePress}
                              labelColorMap={labelColorMap}
                            />
                          </React.Fragment>
                        ))}
                      </>
                    )}
                  </View>
                )}

                {/* Feed heading — sits between the summary cards and the
                    main inbox feed below. */}
                <View style={styles.feedHeader}>
                  <Text style={[styles.feedHeaderText, styles.overlayTextShadow]}>
                    Inbox
                  </Text>
                </View>
              </>
            )}
          </>
        }
        ItemSeparatorComponent={() => (
          <View style={[styles.feedSeparator, { backgroundColor: colors.border }]} />
        )}
        ListEmptyComponent={
          isAuthenticated && !isLoading ? (
            <View style={[styles.feedEmpty, { backgroundColor: colors.background }]}>
              <Text style={[styles.feedEmptyTitle, { color: colors.text }]}>All caught up</Text>
              <Text style={[styles.feedEmptySubtitle, { color: colors.secondaryText }]}>
                Nothing new in your inbox.
              </Text>
            </View>
          ) : isAuthenticated && isLoading ? (
            <View style={styles.loadingContainer}>
              <Loading />
            </View>
          ) : null
        }
      />
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlay: {
    // `absoluteFill` is the typed alias for `absoluteFillObject` — same
    // computed shape, but TS recognises it without complaining.
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  overlayDark: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  topGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 320,
    zIndex: 0,
  },
  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 12,
    zIndex: 1,
  },
  headerButton: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Scroll. `paddingBottom` / `paddingHorizontal` are applied inline so they
  // can include safe-area insets (landscape notch, home indicator) — see JSX.
  scrollContent: {
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%',
  },
  // Week strip — original visual treatment; touch-target a11y is preserved
  // via `hitSlop` on the chevron `TouchableOpacity` (see JSX), not by growing
  // the visible icon button.
  weekStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 4,
  },
  weekArrow: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekStrip: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 2,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 12,
  },
  dayCellActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  dayLabel: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '600',
    marginBottom: 2,
  },
  dayLabelActive: {
    // Oxy purple text on the white-translucent active pill — palette migration
    // from the original Gmail blue. Hex matches Bloom's `oxy` preset primary
    // (HSL 277 66% 56% → #c46ede ish — using the user-facing hex from
    // color-presets.ts so it tracks the same brand value).
    color: '#A23BC2',
  },
  dayNumber: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  dayNumberActive: {
    color: '#A23BC2',
  },
  // Brief title — over photo
  briefTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: 16,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  briefTitleItalic: {
    fontStyle: 'italic',
    fontWeight: '300',
  },
  // Loading
  loadingContainer: {
    paddingTop: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Cards
  card: {
    borderRadius: 16,
    marginBottom: 16,
    ...Platform.select({
      web: { boxShadow: '0 2px 16px rgba(0,0,0,0.10)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 2,
      },
    }),
  },
  // Greeting (only used by the signed-out sign-in card now)
  greetingText: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
  },
  signedOutText: {
    textAlign: 'center',
    marginBottom: 16,
  },
  signedOutCtaWrapper: {
    alignItems: 'center',
  },
  // Flush summary block — renders directly on the photo overlay (no card
  // chrome, no shadow). Used by the AI brief, Needs Response, and Follow Up
  // sections so the home hero stays one continuous visual surface.
  summaryBlock: {
    marginBottom: 20,
  },
  summaryGreeting: {
    // Hero title — primary focal point of the home screen now that the cards
    // are gone. Bumped from 22 → 34 + heavier weight to read like an h1.
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
    lineHeight: 40,
  },
  summaryBriefText: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 22,
  },
  summaryBriefCursor: {
    color: '#FFFFFF',
  },
  overlayTextShadow: {
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  // Stats
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  statPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 5,
  },
  statText: {
    fontSize: 12,
    fontWeight: '600',
  },
  briefLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshButton: {
    alignSelf: 'flex-end',
    padding: 4,
    marginTop: 8,
  },
  digestText: {
    fontSize: 14,
    lineHeight: 22,
  },
  // Section header
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  sectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Empty
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  // Inbox feed (rows under the summary)
  feedHeader: {
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 4,
  },
  feedHeaderText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  feedRow: {
    // Each row sits on the themed background so MessageRow text is readable;
    // first and last row corners are handled by the surrounding card-ish
    // styling around the whole feed.
  },
  feedSeparator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 68,
  },
  feedEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    gap: 6,
    borderRadius: 12,
    marginTop: 8,
  },
  feedEmptyTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  feedEmptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
});
