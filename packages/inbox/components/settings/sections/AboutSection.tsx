/**
 * About subscreen — app metadata + legal/support links.
 *
 * Three blocks: an identity hero, a list of in-app-style link rows, and a
 * credits/copyright footer. The link rows route through `Linking.openURL`
 * so they open the system browser (Safari/Chrome) on every platform.
 */

import React, { useCallback } from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import { Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import { toast } from '@oxyhq/services';
import {
  CircleInfo_Stroke2_Corner0_Rounded,
  PageText_Stroke2_Corner0_Rounded,
  Shield_Stroke2_Corner0_Rounded,
  CircleQuestion_Stroke2_Corner2_Rounded,
  Heart2_Stroke2_Corner0_Rounded,
  SquareArrowTopRight_Stroke2_Corner0_Rounded,
} from '@oxyhq/bloom/icons';

import { useColors } from '@/constants/theme';
import { SectionHeader } from '@/components/settings/SectionHeader';

const LINKS = {
  terms: 'https://oxy.so/terms',
  privacy: 'https://oxy.so/privacy',
  help: 'https://help.oxy.so',
  status: 'https://status.oxy.so',
};

function getAppVersion(): string {
  return Constants.expoConfig?.version ?? '1.0.0';
}

function getPlatformLabel(): string {
  if (Platform.OS === 'web') return 'Web';
  if (Platform.OS === 'ios') return 'iOS';
  if (Platform.OS === 'android') return 'Android';
  return Platform.OS;
}

interface LinkRowProps {
  icon: React.ComponentType<{ size?: 'sm' | 'md'; style?: { color?: string } }>;
  title: string;
  description?: string;
  onPress: () => void;
}

function LinkRow({ icon: Icon, title, description, onPress }: LinkRowProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={title}
      style={({ pressed }) => [styles.linkRow, pressed && { opacity: 0.7 }]}
    >
      <Icon size="md" style={{ color: colors.icon }} />
      <View style={styles.linkText}>
        <Text style={[styles.linkTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {description ? (
          <Text style={[styles.linkSubtitle, { color: colors.secondaryText }]} numberOfLines={1}>
            {description}
          </Text>
        ) : null}
      </View>
      <SquareArrowTopRight_Stroke2_Corner0_Rounded
        size="sm"
        style={{ color: colors.icon, opacity: 0.6 }}
      />
    </Pressable>
  );
}

export function AboutSection() {
  const colors = useColors();
  const theme = useTheme();

  const openLink = useCallback(async (url: string) => {
    try {
      const can = await Linking.canOpenURL(url);
      if (!can) {
        toast.error('Could not open the link in this environment.');
        return;
      }
      await Linking.openURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open link.';
      toast.error(message);
    }
  }, []);

  return (
    <View style={styles.root}>
      <View style={[styles.identityCard, { backgroundColor: theme.colors.backgroundSecondary }]}>
        <Text style={[styles.identityTitle, { color: colors.text }]}>
          Inbox by Oxy
        </Text>
        <Text style={[styles.identitySub, { color: colors.secondaryText }]}>
          {`Version ${getAppVersion()} · ${getPlatformLabel()}`}
        </Text>
      </View>

      <View style={styles.subsection}>
        <SectionHeader icon={CircleInfo_Stroke2_Corner0_Rounded} title="Legal & support" />
        <View style={[styles.linkList, { borderColor: colors.border }]}>
          <LinkRow
            icon={PageText_Stroke2_Corner0_Rounded}
            title="Terms of service"
            onPress={() => openLink(LINKS.terms)}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LinkRow
            icon={Shield_Stroke2_Corner0_Rounded}
            title="Privacy policy"
            onPress={() => openLink(LINKS.privacy)}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LinkRow
            icon={CircleQuestion_Stroke2_Corner2_Rounded}
            title="Help center"
            onPress={() => openLink(LINKS.help)}
          />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <LinkRow
            icon={CircleInfo_Stroke2_Corner0_Rounded}
            title="System status"
            onPress={() => openLink(LINKS.status)}
          />
        </View>
      </View>

      <View style={styles.creditsRow}>
        <Heart2_Stroke2_Corner0_Rounded size="sm" style={{ color: colors.secondaryText }} />
        <Text style={[styles.credits, { color: colors.secondaryText }]}>
          {`Made by the Oxy team · © ${new Date().getFullYear()}`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 24,
  },
  identityCard: {
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 18,
    gap: 4,
  },
  identityTitle: {
    fontSize: 18,
    fontWeight: '600',
  },
  identitySub: {
    fontSize: 13,
  },
  subsection: {
    gap: 12,
  },
  linkList: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  linkText: {
    flex: 1,
    gap: 2,
  },
  linkTitle: {
    fontSize: 15,
    fontWeight: '500',
  },
  linkSubtitle: {
    fontSize: 13,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 46,
    opacity: 0.5,
  },
  creditsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 8,
  },
  credits: {
    fontSize: 12,
  },
});
