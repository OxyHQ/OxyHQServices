import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@oxyhq/bloom/theme';
import { ProfileCard } from '@oxyhq/bloom/profile-card';
import type { ProfileCardProps } from '@oxyhq/bloom/profile-card';
import { DotGridMeter } from '@oxyhq/bloom/dot-grid-meter';
import { StatBar } from '@oxyhq/bloom/stat-bar';
import { ActivityHeatmap, bucketByDay } from '@oxyhq/bloom/activity-heatmap';
import { AvatarGroup } from '@oxyhq/bloom/avatar-group';
import type { AvatarGroupItem } from '@oxyhq/bloom/avatar-group';
import { CompositionBar } from '@oxyhq/bloom/composition-bar';
import type { CompositionCategory } from '@oxyhq/bloom/composition-bar';

/**
 * Bloom Widgets showcase — an Apple-Watch-style gallery of the @oxyhq/bloom
 * @0.30.0 widget components (ProfileCard + its metric primitives). Everything on
 * this screen is mock data; it exists to exercise every new component in both
 * light and dark theme. Colors come from Bloom's useTheme() so the gallery
 * tracks the active color preset like the rest of the app chrome.
 */

// Facepile members for the ProfileCard footers. `name` drives Avatar's colored
// initial placeholder — no real image URLs are needed for the showcase.
const TOKEN_AVATARS: AvatarGroupItem[] = [
  { id: 'btc', name: 'Bitcoin' },
  { id: 'eth', name: 'Ethereum' },
  { id: 'sol', name: 'Solana' },
  { id: 'usdc', name: 'USD Coin' },
  { id: 'ada', name: 'Cardano' },
  { id: 'dot', name: 'Polkadot' },
];

const FOLLOWER_AVATARS: AvatarGroupItem[] = [
  { id: 'u1', name: 'Ada Lovelace' },
  { id: 'u2', name: 'Grace Hopper' },
  { id: 'u3', name: 'Alan Turing' },
  { id: 'u4', name: 'Katherine Johnson' },
  { id: 'u5', name: 'Linus Torvalds' },
];

// Illustrative reputation composition for the CompositionBar demo. Colors are
// mock palette values, not theme tokens — each segment needs a distinct hue.
const COMPOSITION: CompositionCategory[] = [
  { key: 'content', name: 'Content', amount: 320, color: '#8B5CF6' },
  { key: 'social', name: 'Social', amount: 180, color: '#EC4899' },
  { key: 'trust', name: 'Trust', amount: 140, color: '#10B981' },
  { key: 'physical', name: 'Physical', amount: 90, color: '#F59E0B' },
  { key: 'moderation', name: 'Moderation', amount: 60, color: '#3B82F6' },
];

export default function WidgetsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [selectedCategory, setSelectedCategory] = useState<string | null>('trust');

  // The four ProfileCard variants. Each entry is rendered twice below — once as a
  // compact `widget` card and once as a full-width `wide` card — so both layouts
  // are exercised for every variant and every metric kind.
  const cards = useMemo<{ key: string; props: Omit<ProfileCardProps, 'layout'> }[]>(() => {
    // A small filled badge circle pinned to a ProfileCard avatar. The card centers
    // this inside an ~18px slot; the card-colored border punches it off the avatar.
    const chainBadge = (color: string) => (
      <View style={[styles.badge, { backgroundColor: color, borderColor: colors.card }]}>
        <MaterialCommunityIcons name="check-bold" size={9} color="#ffffff" />
      </View>
    );
    return [
      {
        key: 'wallet-dots',
        props: {
          variant: 'wallet',
          avatar: {
            name: 'Main Wallet',
            ring: { colors: colors.success, width: 2 },
            badge: chainBadge('#F7931A'),
          },
          value: '$167,395',
          subtitle: '*5bF5',
          headlineIcon: <MaterialCommunityIcons name="wallet" size={18} color={colors.textTertiary} />,
          metric: { kind: 'dots', label: 'Token diversity', filled: 8, total: 20, filledColor: colors.success },
          footer: { label: 'Top tokens', items: TOKEN_AVATARS, max: 4 },
        },
      },
      {
        key: 'wallet-progress',
        props: {
          variant: 'wallet',
          avatar: {
            name: 'Trading Wallet',
            ring: { colors: colors.primary, width: 2 },
            badge: chainBadge('#627EEA'),
          },
          value: '$64,395',
          subtitle: '*8Sf4',
          headlineIcon: <MaterialCommunityIcons name="swap-horizontal" size={18} color={colors.textTertiary} />,
          metric: {
            kind: 'progress',
            label: 'TX count 24h',
            value: 32,
            max: 350,
            minLabel: '32',
            maxLabel: '350',
            icon: <MaterialCommunityIcons name="trophy" size={14} color={colors.warning} />,
          },
        },
      },
      {
        key: 'wallet-split',
        props: {
          variant: 'wallet',
          avatar: {
            name: 'Savings Wallet',
            ring: { colors: [colors.success, colors.primary], width: 2 },
            badge: chainBadge('#26A17B'),
          },
          value: '$96,395',
          subtitle: '*2Ac9',
          headlineIcon: <MaterialCommunityIcons name="bank" size={18} color={colors.textTertiary} />,
          metric: {
            kind: 'split',
            label: 'Net flow 24h',
            percent: 38,
            leftValue: '$16,495',
            rightValue: '$6,305',
          },
        },
      },
      {
        key: 'social',
        props: {
          variant: 'social',
          avatar: {
            name: 'Ada Lovelace',
            ring: { colors: colors.primary, width: 2 },
            badge: chainBadge(colors.info),
          },
          value: 'Ada Lovelace',
          subtitle: '@ada',
          headlineIcon: <MaterialCommunityIcons name="account-heart" size={18} color={colors.textTertiary} />,
          metric: { kind: 'dots', label: 'Weekly activity', filled: 12, total: 14, filledColor: colors.primary },
          footer: { label: 'Followed by', items: FOLLOWER_AVATARS, max: 4 },
        },
      },
      {
        key: 'shopping',
        props: {
          variant: 'shopping',
          avatar: {
            name: 'Aurora Headphones',
            ring: { colors: colors.warning, width: 2 },
            badge: chainBadge(colors.warning),
          },
          value: '$249.00',
          subtitle: 'Aurora Studio · Audio',
          headlineIcon: <MaterialCommunityIcons name="cart" size={18} color={colors.textTertiary} />,
          metric: {
            kind: 'progress',
            label: 'In stock',
            value: 18,
            max: 50,
            minLabel: '18 left',
            maxLabel: '50',
            icon: <MaterialCommunityIcons name="star" size={14} color={colors.warning} />,
          },
        },
      },
      {
        key: 'stat',
        props: {
          variant: 'stat',
          avatar: {
            name: 'Trust Score',
            ring: { colors: colors.info, width: 2 },
          },
          value: '742',
          subtitle: 'Trust standing',
          headlineIcon: <MaterialCommunityIcons name="shield-check" size={18} color={colors.textTertiary} />,
          metric: {
            kind: 'progress',
            label: 'To next tier',
            value: 742,
            max: 1000,
            minLabel: 'Trusted',
            maxLabel: 'High trust',
            icon: <MaterialCommunityIcons name="chevron-double-up" size={14} color={colors.info} />,
          },
        },
      },
    ];
  }, [colors]);

  // Deterministic ~17 weeks of activity so the heatmap renders a stable gradient
  // in both themes. bucketByDay counts the generated timestamps per calendar day.
  const heatmapData = useMemo(() => {
    const now = new Date();
    const events: { ts: Date }[] = [];
    for (let dayOffset = 0; dayOffset < 119; dayOffset += 1) {
      const day = new Date(now);
      day.setDate(now.getDate() - dayOffset);
      const count = Math.max(0, Math.round((Math.sin(dayOffset / 5) + Math.cos(dayOffset / 11)) * 2 + 2));
      for (let i = 0; i < count; i += 1) events.push({ ts: new Date(day) });
    }
    return bucketByDay(events, (event) => event.ts);
  }, []);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]}
    >
      <View style={styles.intro}>
        <Text style={[styles.h1, { color: colors.text }]}>Bloom Widgets</Text>
        <Text style={[styles.lede, { color: colors.textSecondary }]}>
          @oxyhq/bloom@0.30.0 — Apple-Watch-style ProfileCard stat cards and their metric primitives.
        </Text>
      </View>

      {/* ── ProfileCard gallery ─────────────────────────────────────────── */}
      <SectionHeader title="ProfileCard" subtitle="Widget carousel (240dp) + full-width wide cards" colors={colors} />

      <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>Widget layout</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.carousel}
      >
        {cards.map(({ key, props }) => (
          <ProfileCard key={key} layout="widget" {...props} />
        ))}
      </ScrollView>

      <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>Wide layout</Text>
      <View style={styles.stack}>
        {cards.map(({ key, props }) => (
          <ProfileCard key={key} layout="wide" {...props} />
        ))}
      </View>

      {/* ── Metric primitives ───────────────────────────────────────────── */}
      <SectionHeader title="Primitives" subtitle="The building blocks used inside ProfileCard" colors={colors} />

      <Card colors={colors} label="DotGridMeter">
        <DotGridMeter filled={13} total={30} columns={10} filledColor={colors.success} />
      </Card>

      <Card colors={colors} label="StatBar · progress">
        <StatBar
          variant="progress"
          label="TX count 24h"
          value={128}
          max={350}
          minLabel="128"
          maxLabel="350"
          icon={<MaterialCommunityIcons name="trophy" size={14} color={colors.warning} />}
          fillColor={colors.primary}
        />
      </Card>

      <Card colors={colors} label="StatBar · split">
        <StatBar
          variant="split"
          label="Net flow 24h"
          percent={62}
          leftValue="$16,495"
          rightValue="$6,305"
          fillColor={colors.success}
        />
      </Card>

      <Card colors={colors} label="ActivityHeatmap">
        <ActivityHeatmap data={heatmapData} endDate={today} numDays={119} />
      </Card>

      <Card colors={colors} label="CompositionBar">
        <CompositionBar
          categories={COMPOSITION}
          selectedKey={selectedCategory}
          onSelect={setSelectedCategory}
          hintLabel="Tap a segment to inspect reputation by category"
        />
      </Card>

      <Card colors={colors} label={'AvatarGroup · layout="row"'}>
        <AvatarGroup items={TOKEN_AVATARS} layout="row" size={36} spacing={8} max={6} />
      </Card>

      <Card colors={colors} label={'AvatarGroup · layout="stack"'}>
        <AvatarGroup items={FOLLOWER_AVATARS} layout="stack" size={36} max={4} total={128} />
      </Card>
    </ScrollView>
  );
}

function SectionHeader({
  title,
  subtitle,
  colors,
}: {
  title: string;
  subtitle: string;
  colors: ReturnType<typeof useTheme>['colors'];
}) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.h2, { color: colors.text }]}>{title}</Text>
      <Text style={[styles.h2sub, { color: colors.textSecondary }]}>{subtitle}</Text>
    </View>
  );
}

function Card({
  label,
  colors,
  children,
}: {
  label: string;
  colors: ReturnType<typeof useTheme>['colors'];
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.demoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.demoLabel, { color: colors.textTertiary }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 12,
  },
  intro: {
    gap: 6,
    marginBottom: 4,
  },
  h1: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  lede: {
    fontSize: 15,
    lineHeight: 21,
  },
  sectionHeader: {
    marginTop: 20,
    marginBottom: 4,
    gap: 2,
  },
  h2: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  h2sub: {
    fontSize: 13,
    lineHeight: 18,
  },
  groupLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  carousel: {
    gap: 12,
    paddingVertical: 4,
    paddingRight: 4,
  },
  stack: {
    gap: 12,
  },
  demoCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  demoLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  badge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
