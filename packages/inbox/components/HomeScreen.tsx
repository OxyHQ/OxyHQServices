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
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ImageBackground,
} from 'react-native';
import { Loading } from '@oxyhq/bloom/loading';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useNavigation, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  CheckmarkCircle02Icon,
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
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

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

/** Max number of recent emails to show on home */
const HOME_EMAIL_LIMIT = 10;

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
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'afternoon'>(() =>
    new Date().getHours() < 12 ? 'morning' : 'afternoon',
  );
  const [importantExpanded, setImportantExpanded] = useState(true);
  const [needsResponseExpanded, setNeedsResponseExpanded] = useState(true);
  const [followUpExpanded, setFollowUpExpanded] = useState(true);

  // Recompute `realToday` / `selectedDate` / `timeOfDay` whenever the screen
  // regains focus. This catches the day-rollover case where the user left the
  // app open across midnight and returns to a stale "today" pinned to yesterday.
  useFocusEffect(
    useCallback(() => {
      const now = new Date();
      setRealToday((prev) => (isSameDay(prev, now) ? prev : now));
      setSelectedDate((prev) => (isSameDay(prev, now) ? prev : now));
      const nowTimeOfDay: 'morning' | 'afternoon' = now.getHours() < 12 ? 'morning' : 'afternoon';
      setTimeOfDay((prev) => (prev === nowTimeOfDay ? prev : nowTimeOfDay));
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

  // Filter by selected date AND time of day: morning = received before 12pm, afternoon = 12pm+
  const recentMessages = useMemo(() => {
    const filtered = allMessages.filter((msg) => {
      const msgDate = new Date(msg.date);
      // Must be same day as selected date
      if (!isSameDay(msgDate, selectedDate)) return false;
      // Filter by time of day
      const hour = msgDate.getHours();
      return timeOfDay === 'morning' ? hour < 12 : hour >= 12;
    });
    return filtered.slice(0, HOME_EMAIL_LIMIT);
  }, [allMessages, timeOfDay, selectedDate]);

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

  const firstName = user?.name?.first || user?.username || '';

  // AI daily brief — uses messages from selected date
  const { briefText, isStreaming: briefStreaming, isLoading: briefLoading, error: briefError, regenerate } = useDailyBrief(dayMessages, firstName);

  // AI-powered sections: emails needing response and follow-up
  const { messages: needsResponseMessages, count: needsResponseCount } = useNeedsResponse(allMessages, 5);
  const { messages: followUpMessages, count: followUpCount, isLoading: followUpLoading } = useFollowUp(allMessages, 5);

  // Greeting respects empty user (signed-out / not loaded yet) — no dangling comma.
  // `timeOfDay` is still maintained for filtering recent messages but no longer
  // exposed as a toggle in the UI.
  const greetingBase = getGreeting();
  const greetingLine = firstName ? `${greetingBase}, ${firstName}` : greetingBase;
  const today = selectedDate;
  const dateString = `${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

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

      {/* Header bar */}
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
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Date & Week Strip */}
        <Text style={styles.monthYear}>{MONTHS[today.getMonth()]} {today.getFullYear()}</Text>
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
            // Keep the visible icon small to match the original look; touch
            // target is grown to ~44pt via hitSlop instead.
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
            // Keep the visible icon small to match the original look; touch
            // target is grown to ~44pt via hitSlop instead.
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {/* "Go to today" chip */}
        {!isOnToday && (
          <View style={styles.todayChipRow}>
            <TouchableOpacity
              style={styles.todayChip}
              onPress={() => setSelectedDate(new Date())}
              activeOpacity={0.7}
              accessibilityLabel="Jump to today"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="calendar-today" size={14} color="#FFFFFF" />
              <Text style={styles.todayChipText}>Today</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Today's Brief Title */}
        <Text style={styles.briefTitle}>
          <Text style={styles.briefTitleItalic}>Today's Brief</Text>
          {' — '}
          {dateString}
        </Text>

        {!isAuthenticated ? (
          /*
           * Signed-out variant — hide AI brief / needs-response / follow-up /
           * important cards (they all require authenticated mailbox access) and
           * show a single sign-in CTA card instead.
           */
          <View style={[styles.card, { backgroundColor: colors.background }]}>
            <View style={styles.cardContent}>
              <Text style={[styles.greetingText, { color: colors.text }]}>
                {greetingLine}
              </Text>
              <Text style={[styles.digestText, styles.signedOutText, { color: colors.secondaryText }]}>
                Sign in to see your daily brief, emails that need a reply, and
                follow-ups waiting on you.
              </Text>
              <View style={styles.signedOutCtaWrapper}>
                <OxySignInButton variant="contained" />
              </View>
            </View>
          </View>
        ) : isLoading ? (
          <View style={styles.loadingContainer}>
            <Loading />
          </View>
        ) : (
          <>
            {/*
             * Summary / AI brief block — renders FLUSH against the photo
             * background (no card wrapper, no rounded panel, no shadow). Just
             * the greeting, stat pills, and brief text on the overlay.
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

            {/*
             * Needs Response — sub-content below the hero; uses the standard
             * card style so it reads as a list panel separate from the flush
             * AI summary above.
             */}
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

            {/* Follow Up — card-styled list (sub-content). */}
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

            {/* Important Information */}
            <View style={[styles.card, { backgroundColor: colors.background }]}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setImportantExpanded((v) => !v)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Important information"
                accessibilityState={{ expanded: importantExpanded }}
              >
                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                  Important Information
                </Text>
                {Platform.OS === 'web' ? (
                  <HugeiconsIcon
                    icon={(importantExpanded ? ArrowUp01Icon : ArrowDown01Icon) as unknown as IconSvgElement}
                    size={20}
                    color={colors.secondaryText}
                  />
                ) : (
                  <MaterialCommunityIcons
                    name={importantExpanded ? 'chevron-up' : 'chevron-down'}
                    size={20}
                    color={colors.secondaryText}
                  />
                )}
              </TouchableOpacity>

              {importantExpanded && (
                <>
                  {recentMessages.length > 0 ? (
                    recentMessages.map((msg, index) => (
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
                    ))
                  ) : (
                    <View style={styles.emptyContainer}>
                      {Platform.OS === 'web' ? (
                        <HugeiconsIcon icon={CheckmarkCircle02Icon as unknown as IconSvgElement} size={40} color={colors.success} />
                      ) : (
                        <MaterialCommunityIcons name="check-circle-outline" size={40} color={colors.success} />
                      )}
                      <Text style={[styles.emptyTitle, { color: colors.text }]}>All clear</Text>
                      <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
                        No priority emails right now. Enjoy your day!
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </>
        )}
      </ScrollView>
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
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
  },
  // Scroll
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%',
  },
  // Month / Year — over photo, white with subtle shadow for legibility
  monthYear: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
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
  // Today chip — over photo
  todayChipRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  todayChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    gap: 6,
  },
  todayChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
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
  cardContent: {
    padding: 20,
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
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
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
  summarySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingVertical: 8,
    marginBottom: 8,
  },
  summarySectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  summaryRowsHolder: {
    // Subtle white-ish backdrop so MessageRow content reads on the photo,
    // without a hard card edge. Visually feels like translucent glass.
    borderRadius: 12,
    overflow: 'hidden',
    ...Platform.select({
      web: { boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 4,
        elevation: 1,
      },
    }),
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
});
