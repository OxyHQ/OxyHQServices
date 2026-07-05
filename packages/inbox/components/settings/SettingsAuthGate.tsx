/**
 * Empty-state shown when an unauthenticated user navigates to a settings
 * section that requires sign-in (e.g. Account, Notifications, Privacy).
 *
 * Renders a small Bloom icon, a short rationale, and the `OxySignInButton`
 * to flow back into auth. Sized to match the restrained Alia/Bloom look
 * (no big tinted circles).
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { OxySignInButton } from '@oxyhq/services';
import { H4, P } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import type { Props as IconProps } from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';

interface SettingsAuthGateProps {
  /** Section label (e.g. "Notifications"). */
  sectionLabel: string;
  /** Bloom icon component. */
  icon: React.ComponentType<IconProps>;
}

export function SettingsAuthGate({ sectionLabel, icon: Icon }: SettingsAuthGateProps) {
  const colors = useColors();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <Icon size="xl" style={{ color: theme.colors.primary }} />
      <View style={styles.text}>
        <H4 style={styles.title}>{sectionLabel}</H4>
        <P style={[styles.subtitle, { color: colors.secondaryText }]}>
          Sign in to access your {sectionLabel.toLowerCase()}.
        </P>
      </View>
      <OxySignInButton variant="contained" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 32,
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  text: {
    alignItems: 'center',
    gap: 4,
  },
  title: {
    textAlign: 'center',
    fontSize: 20,
  },
  subtitle: {
    textAlign: 'center',
    fontSize: 14,
    maxWidth: 320,
  },
});
