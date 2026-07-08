/**
 * "For You" screen — curated highlights using the full content width.
 *
 * Shows starred messages, unread highlights, and recent attachments
 * in horizontally scrollable rows with navigation arrows.
 */

import React, { useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  useWindowDimensions,
  type NativeSyntheticEvent,
  type NativeScrollEvent,
} from 'react-native';
import { Loading } from '@oxyhq/bloom/loading';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  StarIcon,
  Mail01Icon,
  Attachment01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Menu01Icon,
  InboxIcon,
} from '@hugeicons/core-free-icons';
import { useRouter, useNavigation } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColors } from '@/constants/theme';
import { SPECIAL_USE } from '@/constants/mailbox';
import { useMessages } from '@/hooks/queries/useMessages';
import { useMailboxes } from '@/hooks/queries/useMailboxes';
import { useLabels } from '@/hooks/queries/useLabels';
import { useEmailStore } from '@/hooks/useEmail';
import { useToggleStar } from '@/hooks/mutations/useMessageMutations';
import { useMessageActions } from '@/hooks/useMessageActions';
import { MessageRow } from '@/components/MessageRow';
import type { Message } from '@/services/emailApi';

const CARD_WIDTH = 320;
const CARD_GAP = 12;
const SCROLL_AMOUNT = CARD_WIDTH + CARD_GAP;

const SECTION_ICONS: Record<string, { huge: IconSvgElement; fallback: keyof typeof MaterialCommunityIcons.glyphMap }> = {
  star: { huge: StarIcon as unknown as IconSvgElement, fallback: 'star' },
  'email-outline': { huge: Mail01Icon as unknown as IconSvgElement, fallback: 'email-outline' },
  paperclip: { huge: Attachment01Icon as unknown as IconSvgElement, fallback: 'paperclip' },
};

function summarizeSection(items: Message[]): string {
  const senders = [...new Set(items.map((m) => m.from.name || m.from.address.split('@')[0]))];
  const subjects = items
    .map((m) => m.subject)
    .filter(Boolean)
    .slice(0, 3);

  if (senders.length === 0) return '';

  const senderPart =
    senders.length === 1
      ? `From ${senders[0]}`
      : senders.length === 2
        ? `From ${senders[0]} and ${senders[1]}`
        : `From ${senders[0]}, ${senders[1]} and ${senders.length - 2} other${senders.length - 2 > 1 ? 's' : ''}`;

  const topicPart =
    subjects.length > 0
      ? ` — about ${subjects.slice(0, 2).join(', ')}${subjects.length > 2 ? ' and more' : ''}`
      : '';

  return senderPart + topicPart;
}

function HorizontalSection({
  title,
  description,
  icon,
  items,
  iconColor,
  colors,
  onMessagePress,
  onStar,
  labelColorMap,
  horizontalInset,
}: {
  title: string;
  description: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  items: Message[];
  iconColor: string;
  colors: ReturnType<typeof useColors>;
  onMessagePress: (id: string) => void;
  onStar: (id: string) => void;
  labelColorMap?: Map<string, string>;
  /** Extra horizontal padding to add for landscape notch clearance. */
  horizontalInset: { left: number; right: number };
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollXRef = useRef(0);
  const contentWidthRef = useRef(0);
  const containerWidthRef = useRef(0);

  const updateArrows = useCallback(() => {
    const x = scrollXRef.current;
    const maxScroll = contentWidthRef.current - containerWidthRef.current;
    setCanScrollLeft(x > 0);
    setCanScrollRight(maxScroll > 0 && x < maxScroll - 1);
  }, []);

  const handleScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollXRef.current = e.nativeEvent.contentOffset.x;
      containerWidthRef.current = e.nativeEvent.layoutMeasurement.width;
      contentWidthRef.current = e.nativeEvent.contentSize.width;
      updateArrows();
    },
    [updateArrows],
  );

  const scrollBy = useCallback((direction: number) => {
    const target = scrollXRef.current + direction * SCROLL_AMOUNT;
    scrollRef.current?.scrollTo({ x: Math.max(0, target), animated: true });
  }, []);

  if (items.length === 0) return null;

  const sectionIcon = SECTION_ICONS[icon];

  return (
    <View style={styles.section}>
      <View
        style={[
          styles.sectionHeader,
          { paddingLeft: 16 + horizontalInset.left, paddingRight: 16 + horizontalInset.right },
        ]}
      >
        {Platform.OS === 'web' && sectionIcon ? (
          <HugeiconsIcon icon={sectionIcon.huge} size={20} color={iconColor} />
        ) : (
          <MaterialCommunityIcons name={icon} size={20} color={iconColor} />
        )}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.sectionCount, { color: colors.secondaryText }]}>{items.length}</Text>
      </View>
      <Text
        style={[
          styles.sectionDescription,
          { color: colors.secondaryText, paddingLeft: 16 + horizontalInset.left, paddingRight: 16 + horizontalInset.right },
        ]}
      >
        {description}
      </Text>

      <View style={styles.scrollContainer}>
        {canScrollLeft && (
          <TouchableOpacity
            style={[styles.arrowButton, styles.arrowLeft, { backgroundColor: colors.surface }]}
            onPress={() => scrollBy(-1)}
            activeOpacity={0.7}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={ArrowLeft01Icon as unknown as IconSvgElement} size={24} color={colors.text} />
            ) : (
              <MaterialCommunityIcons name="chevron-left" size={24} color={colors.text} />
            )}
          </TouchableOpacity>
        )}

        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingLeft: 16 + horizontalInset.left, paddingRight: 16 + horizontalInset.right },
          ]}
        >
          {items.map((message) => (
            <View
              key={message._id}
              style={[styles.cardWrapper, { backgroundColor: colors.surface }]}
            >
              <MessageRow
                message={message}
                onSelect={onMessagePress}
                onStar={onStar}
                labelColorMap={labelColorMap}
              />
            </View>
          ))}
        </ScrollView>

        {canScrollRight && (
          <TouchableOpacity
            style={[styles.arrowButton, styles.arrowRight, { backgroundColor: colors.surface }]}
            onPress={() => scrollBy(1)}
            activeOpacity={0.7}
          >
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={ArrowRight01Icon as unknown as IconSvgElement} size={24} color={colors.text} />
            ) : (
              <MaterialCommunityIcons name="chevron-right" size={24} color={colors.text} />
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

interface DrawerNavigation {
  openDrawer?: () => void;
  dispatch?: (action: unknown) => void;
}

export function ForYouScreen() {
  const router = useRouter();
  const navigation = useNavigation<DrawerNavigation>();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const colors = useColors();
  const isDesktop = Platform.OS === 'web' && width >= 900;

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
  const messageActions = useMessageActions();

  const messages = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data]);

  const starred = useMemo(() => messages.filter((m) => m.flags.starred).slice(0, 6), [messages]);
  const unread = useMemo(
    () => messages.filter((m) => !m.flags.seen && !m.flags.starred).slice(0, 6),
    [messages],
  );
  const withAttachments = useMemo(
    () => messages.filter((m) => m.attachments.length > 0).slice(0, 6),
    [messages],
  );

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
      messageActions.prepareOpenMessage(messageId);
      router.push(`/conversation/${messageId}`);
    },
    [router, messageActions],
  );

  const handleStar = useCallback(
    (messageId: string) => {
      const msg = messages.find((m) => m._id === messageId);
      if (msg) toggleStar.mutate({ messageId, starred: !msg.flags.starred });
    },
    [messages, toggleStar],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View
        style={[
          styles.header,
          { borderBottomColor: colors.border },
          !isDesktop && { paddingTop: insets.top },
        ]}
      >
        {!isDesktop && (
          <TouchableOpacity onPress={handleOpenDrawer} style={styles.iconButton}>
            {Platform.OS === 'web' ? (
              <HugeiconsIcon icon={Menu01Icon as unknown as IconSvgElement} size={24} color={colors.icon} />
            ) : (
              <MaterialCommunityIcons name="menu" size={24} color={colors.icon} />
            )}
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.text }]}>For You</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <Loading />
        </View>
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.bodyContent,
            {
              // NativeTabs already adds bottom safe-area inset on Android.
              // iOS / web apply it explicitly here.
              paddingBottom: Platform.OS === 'android' ? 40 : insets.bottom + 40,
            },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <HorizontalSection
            title="Starred"
            description={summarizeSection(starred)}
            icon="star"
            items={starred}
            iconColor={colors.starred}
            colors={colors}
            onMessagePress={handleMessagePress}
            onStar={handleStar}
            labelColorMap={labelColorMap}
            horizontalInset={{ left: insets.left, right: insets.right }}
          />
          <HorizontalSection
            title="Unread"
            description={summarizeSection(unread)}
            icon="email-outline"
            items={unread}
            iconColor={colors.primary}
            colors={colors}
            onMessagePress={handleMessagePress}
            onStar={handleStar}
            labelColorMap={labelColorMap}
            horizontalInset={{ left: insets.left, right: insets.right }}
          />
          <HorizontalSection
            title="Attachments"
            description={summarizeSection(withAttachments)}
            icon="paperclip"
            items={withAttachments}
            iconColor={colors.icon}
            colors={colors}
            onMessagePress={handleMessagePress}
            onStar={handleStar}
            labelColorMap={labelColorMap}
            horizontalInset={{ left: insets.left, right: insets.right }}
          />

          {starred.length === 0 && unread.length === 0 && withAttachments.length === 0 && (
            <View style={styles.emptyContainer}>
              {Platform.OS === 'web' ? (
                <HugeiconsIcon icon={InboxIcon as unknown as IconSvgElement} size={64} color={colors.border} />
              ) : (
                <MaterialCommunityIcons name="inbox-outline" size={64} color={colors.border} />
              )}
              <Text style={[styles.emptyTitle, { color: colors.text }]}>All caught up</Text>
              <Text style={[styles.emptySubtitle, { color: colors.secondaryText }]}>
                Nothing highlighted for you right now.
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
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
  body: {
    flex: 1,
  },
  // `paddingBottom` is applied inline so it can include the safe-area bottom
  // inset on iOS/web (NativeTabs handles Android automatically) — see JSX.
  bodyContent: {
    paddingVertical: 16,
  },
  section: {
    marginBottom: 28,
  },
  // `paddingHorizontal` for sectionHeader / sectionDescription / scrollContent
  // is applied inline so they can include landscape `insets.left` / `insets.right`.
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    flex: 1,
  },
  sectionCount: {
    fontSize: 13,
    fontWeight: '500',
  },
  sectionDescription: {
    fontSize: 13,
    marginBottom: 12,
    marginTop: -4,
  },
  scrollContainer: {
    position: 'relative',
  },
  scrollContent: {
    gap: CARD_GAP,
  },
  cardWrapper: {
    width: CARD_WIDTH,
    borderRadius: 12,
    overflow: 'hidden',
  },
  arrowButton: {
    position: 'absolute',
    top: '50%',
    marginTop: -18,
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  arrowLeft: {
    left: 8,
  },
  arrowRight: {
    right: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 16,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 14,
  },
});
