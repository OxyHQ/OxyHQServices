/**
 * Notifications subscreen — push, digest, and sound preferences.
 *
 * Toggles persist via `useInboxPrefs` (local-device storage). The device
 * push token registration (Expo Notifications) is handled at the app
 * shell layer; this screen controls whether we *route* notifications to
 * the user.
 *
 * Layout: small icon-eyebrow subsections each with two or three visual
 * toggles — not the iOS row-spam pattern.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Switch } from '@oxyhq/bloom/switch';
import { Text } from '@oxyhq/bloom/typography';
import { Admonition } from '@oxyhq/bloom/admonition';
import {
  Bell_Stroke2_Corner0_Rounded,
  SpeakerVolumeFull_Stroke2_Corner0_Rounded,
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

export function NotificationsSection() {
  const { prefs, setPref } = useInboxPrefs();

  return (
    <View style={styles.root}>
      <View style={styles.subsection}>
        <SectionHeader icon={Bell_Stroke2_Corner0_Rounded} title="Alerts" />
        <View style={styles.toggleGroup}>
          <InlineToggle
            title="Push notifications"
            description="Get notified when new messages arrive."
            value={prefs.pushNotifications}
            onChange={(v) => setPref('pushNotifications', v)}
          />
          <InlineToggle
            title="Daily email digest"
            description="A summary of unread messages, once per day."
            value={prefs.emailDigest}
            onChange={(v) => setPref('emailDigest', v)}
          />
        </View>
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={SpeakerVolumeFull_Stroke2_Corner0_Rounded} title="Sound" />
        <View style={styles.toggleGroup}>
          <InlineToggle
            title="Play sound"
            description="A short chime on new messages."
            value={prefs.notificationSound}
            onChange={(v) => setPref('notificationSound', v)}
          />
        </View>
      </View>

      {Platform.OS !== 'web' ? (
        <Admonition type="info">
          System-level notification permissions are managed in your device settings.
        </Admonition>
      ) : null}
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
