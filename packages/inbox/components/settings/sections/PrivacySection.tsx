/**
 * Privacy subscreen — tracking protection + sender trust.
 *
 * Today the underlying protections are enabled by default and not per-row
 * configurable. We surface them as disabled toggles so users can see the
 * surface area, with an admonition that explains the roadmap.
 */

import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Admonition } from '@oxyhq/bloom/admonition';
import {
  ChainLink_Stroke2_Corner0_Rounded,
  CircleBanSign_Stroke2_Corner0_Rounded,
  EyeSlash_Stroke2_Corner0_Rounded,
  Verified_Stroke2_Corner2_Rounded,
} from '@oxyhq/bloom/icons';
import { Switch } from '@oxyhq/bloom/switch';
import { Text } from '@oxyhq/bloom/typography';

import { SectionHeader } from '@/components/settings/SectionHeader';
import { useColors } from '@/constants/theme';

interface DisabledToggleProps {
  title: string;
  description: string;
}

const NOOP = () => {
  // No-op stub for the disabled switches — wired once server-backed privacy
  // preferences ship. Each protection is already enabled by default.
};

function DisabledToggle({ title, description }: DisabledToggleProps) {
  const colors = useColors();

  return (
    <View style={styles.inlineToggle}>
      <View style={styles.inlineToggleText}>
        <Text style={[styles.inlineToggleTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.inlineToggleSub, { color: colors.secondaryText }]}>
          {description}
        </Text>
      </View>
      <Switch value onValueChange={NOOP} disabled />
    </View>
  );
}

export function PrivacySection() {
  const colors = useColors();

  return (
    <View style={styles.root}>
      <Admonition type="info">
        Privacy protections are on by default. Per-feature toggles are coming soon.
      </Admonition>

      <View style={styles.subsection}>
        <SectionHeader icon={EyeSlash_Stroke2_Corner0_Rounded} title="Tracking protection" />
        <View style={styles.toggleGroup}>
          <DisabledToggle
            title="Block remote images"
            description="Don't load images from external servers until you tap to allow."
          />
          <DisabledToggle
            title="Hide IP from senders"
            description="Image and font loads route through Oxy's privacy proxy."
          />
          <DisabledToggle
            title="Strip tracking parameters"
            description="Remove tracking tokens from links in messages."
          />
        </View>
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={Verified_Stroke2_Corner2_Rounded} title="Sender trust" />
        <View style={styles.toggleGroup}>
          <DisabledToggle
            title="Sender verification"
            description="Show whether messages are signed by their claimed domain."
          />
          <Pressable
            disabled
            style={styles.blockListRow}
            accessibilityRole="button"
            accessibilityLabel="Manage block list"
            accessibilityState={{ disabled: true }}
          >
            <CircleBanSign_Stroke2_Corner0_Rounded
              size="md"
              style={{ color: colors.icon, opacity: 0.6 }}
            />
            <View style={styles.inlineToggleText}>
              <Text style={[styles.inlineToggleTitle, { color: colors.text, opacity: 0.6 }]}>
                Block list
              </Text>
              <Text style={[styles.inlineToggleSub, { color: colors.secondaryText }]}>
                No senders are currently blocked.
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={ChainLink_Stroke2_Corner0_Rounded} title="Why these defaults?" />
        <Text style={[styles.body, { color: colors.secondaryText }]}>
          Oxy follows a privacy-by-default posture: senders never see your IP, location, or read
          receipts, and tracking pixels are blocked at the network edge. We'll surface granular
          per-message and per-sender overrides as the protections mature.
        </Text>
      </View>
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
  blockListRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
  },
});
