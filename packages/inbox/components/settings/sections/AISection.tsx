/**
 * AI features subscreen — opt-in toggles for AI conveniences.
 *
 * Persists via `useInboxPrefs` (local-device). The feature surfaces in
 * the inbox (DailyBrief card, SmartReply suggestions, auto-categorization)
 * read these flags at render time and skip their work when disabled.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Switch } from '@oxyhq/bloom/switch';
import { Text } from '@oxyhq/bloom/typography';
import { Admonition } from '@oxyhq/bloom/admonition';
import {
  Sparkle_Stroke2_Corner0_Rounded,
  Bot_Stroke,
  Reply,
} from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { SectionHeader } from '@/components/settings/SectionHeader';
import { useInboxPrefs } from '@/contexts/inbox-prefs-context';

interface InlineToggleProps {
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
}

function InlineToggle({ title, description, value, onChange }: InlineToggleProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={styles.inlineToggle}
    >
      <View style={styles.inlineToggleText}>
        <Text style={[styles.inlineToggleTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.inlineToggleSub, { color: colors.secondaryText }]}>
          {description}
        </Text>
      </View>
      <Switch value={value} onValueChange={onChange} />
    </Pressable>
  );
}

export function AISection() {
  const { prefs, setPref } = useInboxPrefs();

  return (
    <View style={styles.root}>
      <View style={styles.subsection}>
        <SectionHeader icon={Sparkle_Stroke2_Corner0_Rounded} title="Daily Brief" />
        <View style={styles.toggleGroup}>
          <InlineToggle
            title="Morning recap"
            description="A short summary of overnight messages, surfaced on Home."
            value={prefs.aiBrief}
            onChange={(v) => setPref('aiBrief', v)}
          />
        </View>
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={Reply} title="Smart Reply" />
        <View style={styles.toggleGroup}>
          <InlineToggle
            title="One-tap suggestions"
            description="Three context-aware reply chips above the message."
            value={prefs.aiSmartReply}
            onChange={(v) => setPref('aiSmartReply', v)}
          />
        </View>
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={Bot_Stroke} title="Categorization" />
        <View style={styles.toggleGroup}>
          <InlineToggle
            title="Auto-bucket messages"
            description="Sort incoming mail into Travel, Purchases, Bills, and more."
            value={prefs.aiCategorization}
            onChange={(v) => setPref('aiCategorization', v)}
          />
        </View>
      </View>

      <Admonition type="tip">
        Turning a feature off stops new processing. Existing AI annotations stay until you delete them.
      </Admonition>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 28,
  },
  subsection: {
    gap: 12,
  },
  toggleGroup: {
    gap: 4,
  },
  inlineToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  inlineToggleText: {
    flex: 1,
    gap: 2,
  },
  inlineToggleTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  inlineToggleSub: {
    fontSize: 13,
    lineHeight: 17,
  },
});
