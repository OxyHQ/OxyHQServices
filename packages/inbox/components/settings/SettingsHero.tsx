/**
 * Hero card rendered at the top of the settings landing page.
 *
 * Signed-in: shows the user's avatar + display name + email handle, with a
 * subtle "Manage account" chevron-row affordance that routes to the Account
 * subscreen for editing.
 *
 * Signed-out: shows a friendly call-to-action with the `OxySignInButton`.
 */

import React, { useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '@oxyhq/bloom/avatar';
import { H3, P, Text } from '@oxyhq/bloom/typography';
import { useTheme } from '@oxyhq/bloom/theme';
import { ChevronRight_Stroke2_Corner0_Rounded } from '@oxyhq/bloom/icons';
import { useOxy, OxySignInButton } from '@oxyhq/services';
import { getNormalizedUserHandle } from '@oxyhq/core';
import { useRouter } from 'expo-router';

import { useColors } from '@/constants/theme';

export function SettingsHero() {
  const router = useRouter();
  const colors = useColors();
  const theme = useTheme();
  const { user, isAuthenticated } = useOxy();

  const handlePress = useCallback(() => {
    router.push('/settings/account');
  }, [router]);

  if (!isAuthenticated || !user) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: theme.colors.backgroundSecondary },
        ]}
      >
        <View style={styles.signedOutContent}>
          <H3 style={styles.signedOutTitle}>Welcome to Inbox</H3>
          <P style={[styles.signedOutBody, { color: colors.secondaryText }]}>
            Sign in to sync your messages, labels, and preferences across devices.
          </P>
        </View>
        <OxySignInButton variant="contained" />
      </View>
    );
  }

  const fullName = user?.name?.displayName || getNormalizedUserHandle(user) || '';
  const emailHandle = user.email || `${user.username}@oxy.so`;

  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`Manage account for ${fullName}`}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: theme.colors.backgroundSecondary },
        pressed && { opacity: 0.85 },
      ]}
    >
      <Avatar
        source={user.avatar}
        variant="thumb"
        name={fullName}
        size={56}
      />
      <View style={styles.identity}>
        <Text style={styles.name} numberOfLines={1}>{fullName}</Text>
        <Text style={[styles.handle, { color: colors.secondaryText }]} numberOfLines={1}>
          {emailHandle}
        </Text>
      </View>
      <ChevronRight_Stroke2_Corner0_Rounded size="md" style={{ color: colors.icon }} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
  },
  handle: {
    fontSize: 14,
  },
  signedOutContent: {
    flex: 1,
    gap: 4,
  },
  signedOutTitle: {
    fontSize: 18,
  },
  signedOutBody: {
    fontSize: 13,
    lineHeight: 18,
  },
});
