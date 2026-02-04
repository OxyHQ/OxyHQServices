/**
 * Home screen — personalized greeting with AI summary of important emails.
 *
 * Full-bleed background image with overlaid content cards.
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
  ActivityIndicator,
  ImageBackground,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useOxy } from '@oxyhq/services';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  CheckmarkCircle02Icon,
  ArrowUp01Icon,
  ArrowDown01Icon,
  Menu01Icon,
} from '@hugeicons/core-free-icons';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useToggleStar } from '@/hooks/mutations/useMessageMutations';
import { useEmailStore } from '@/hooks/useEmail';
import { MessageRow } from '@/components/MessageRow';
import { LogoIcon } from '@/assets/logo';
import type { Message } from '@/services/emailApi';

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

/** Mock AI digest */
const AI_DIGEST = `You have 5 emails that need attention. Sarah shared dashboard mockups (v3) and needs your feedback before engineering handoff. Alex's Q1 roadmap is in — your estimates are due Friday. Marcus opened a PR fixing the auth token refresh race condition that needs code review. There's also a failed Vercel deployment on main (auth module) and Emma is waiting on your approval for staging API keys.`;

/** Max number of recent emails to show on home */
const HOME_EMAIL_LIMIT = 10;

export function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colorScheme = useColorScheme();
  const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);
  const isDesktop = Platform.OS === 'web' && width >= 900;
  const { user } = useOxy();

  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [timeOfDay, setTimeOfDay] = useState<'morning' | 'afternoon'>(() =>
    new Date().getHours() < 12 ? 'morning' : 'afternoon',
  );
  const [importantExpanded, setImportantExpanded] = useState(true);

  const weekDays = useMemo(() => getWeekDays(selectedDate), [selectedDate]);

  const { data: mailboxes = [] } = useMailboxes();
  const inboxId = mailboxes.find((m) => m.specialUse === 'Inbox')?._id;
  const { data, isLoading } = useMessages(inboxId ? { mailboxId: inboxId } : {});
  const toggleStar = useToggleStar();

  const allMessages = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  const recentMessages = useMemo(() => allMessages.slice(0, HOME_EMAIL_LIMIT), [allMessages]);

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
  const today = selectedDate;
  const dateString = `${MONTHS[today.getMonth()]} ${today.getDate()}, ${today.getFullYear()}`;

  return (
    <ImageBackground
      source={require('@/assets/images/home.jpg')}
      style={styles.container}
      resizeMode="cover"
    >
      {/* Dark overlay for readability */}
      <View style={styles.overlay} />

      {/* Header bar */}
      <View style={[styles.header, { paddingTop: isDesktop ? 16 : insets.top + 8 }]}>
        {!isDesktop && (
          <TouchableOpacity onPress={handleOpenDrawer} style={styles.headerButton}>
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
            onPress={() => setSelectedDate((d) => {
              const prev = new Date(d);
              prev.setDate(prev.getDate() - 7);
              return prev;
            })}
            style={styles.weekArrow}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-left" size={20} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
          <View style={styles.weekStrip}>
            {weekDays.map((d, i) => {
              const isSelected =
                d.getDate() === today.getDate() &&
                d.getMonth() === today.getMonth() &&
                d.getFullYear() === today.getFullYear();
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.dayCell, isSelected && styles.dayCellActive]}
                  onPress={() => setSelectedDate(new Date(d))}
                  activeOpacity={0.7}
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
            onPress={() => setSelectedDate((d) => {
              const next = new Date(d);
              next.setDate(next.getDate() + 7);
              return next;
            })}
            style={styles.weekArrow}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons name="chevron-right" size={20} color="rgba(255,255,255,0.7)" />
          </TouchableOpacity>
        </View>

        {/* Today's Brief Title */}
        <Text style={styles.briefTitle}>
          <Text style={styles.briefTitleItalic}>Today's Brief</Text>
          {' — '}
          {dateString}
        </Text>

        {/* Time of day toggle */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleContainer}>
            <TouchableOpacity
              style={[styles.toggleButton, timeOfDay === 'morning' && styles.toggleButtonActive]}
              onPress={() => setTimeOfDay('morning')}
              activeOpacity={0.7}
            >
              <Text style={styles.toggleIcon}>☀️</Text>
              <Text style={[styles.toggleText, timeOfDay === 'morning' && styles.toggleTextActive]}>
                Morning
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.toggleButton, timeOfDay === 'afternoon' && styles.toggleButtonActive]}
              onPress={() => setTimeOfDay('afternoon')}
              activeOpacity={0.7}
            >
              <Text style={styles.toggleIcon}>🌙</Text>
              <Text style={[styles.toggleText, timeOfDay === 'afternoon' && styles.toggleTextActive]}>
                Afternoon
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#FFFFFF" />
          </View>
        ) : (
          <>
            {/* Greeting Card */}
            <View style={[styles.card, { backgroundColor: colors.background }]}>
              <Text style={[styles.greetingText, { color: colors.text }]}>
                {greeting}, {firstName}
              </Text>
              <Text style={[styles.digestText, { color: colors.secondaryText }]}>
                {AI_DIGEST}
              </Text>
            </View>

            {/* Important Information */}
            <View style={[styles.card, { backgroundColor: colors.background }]}>
              <TouchableOpacity
                style={styles.sectionHeader}
                onPress={() => setImportantExpanded((v) => !v)}
                activeOpacity={0.7}
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
                          <View style={[styles.separator, { backgroundColor: colors.border }]} />
                        )}
                        <MessageRow
                          message={msg}
                          onStar={handleStar}
                          onSelect={handleMessagePress}
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
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
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  // Scroll
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    maxWidth: 700,
    alignSelf: 'center',
    width: '100%',
  },
  // Month / Year
  monthYear: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  // Week strip
  weekStripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
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
    color: '#1A73E8',
  },
  dayNumber: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  dayNumberActive: {
    color: '#1A73E8',
  },
  // Brief title
  briefTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '400',
    textAlign: 'center',
    marginBottom: 16,
    textShadowColor: 'rgba(0,0,0,0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  briefTitleItalic: {
    fontStyle: 'italic',
    fontWeight: '300',
  },
  // Time toggle
  toggleRow: {
    alignItems: 'center',
    marginBottom: 20,
  },
  toggleContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
    padding: 3,
  },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 18,
    gap: 6,
  },
  toggleButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  toggleIcon: {
    fontSize: 14,
  },
  toggleText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#333333',
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
    padding: 20,
    marginBottom: 16,
    ...Platform.select({
      web: { boxShadow: '0 2px 16px rgba(0,0,0,0.10)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 3,
      },
    }),
  },
  // Greeting
  greetingText: {
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 12,
    textAlign: 'center',
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
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  separator: {
    height: StyleSheet.hairlineWidth,
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
