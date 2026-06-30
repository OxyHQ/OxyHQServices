import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';
import { getAccountDisplayName } from '@oxyhq/core';
import { useI18n } from '../hooks/useI18n';

/**
 * ActiveAccountBanner — a subtle context cue shown when the active account is an
 * account the user switched INTO (an org / project / bot / shared account)
 * rather than their own personal account.
 *
 * Framing: this reads as the CURRENT account, NOT as delegation. There is no
 * "acting as" / "on behalf of" copy and no "switch back" affordance — switching
 * into an account makes the whole app become that account, and the banner simply
 * confirms which account is active. To change accounts (including returning to
 * the personal account) the user opens the unified account switcher and picks
 * one; tapping the banner opens it.
 *
 * Renders nothing on the personal account. Place it in your app's layout where a
 * persistent "you're in <Account>" cue is useful (typically below the header).
 * The "account" here is the relational Account, NOT the cryptographic
 * Commons/DID identity.
 */
const ActiveAccountBanner: React.FC = () => {
  const bloomTheme = useTheme();
  const { actingAsAccount, showBottomSheet, oxyServices } = useOxy();
  const { t, locale } = useI18n();

  const account = actingAsAccount?.account ?? null;

  // Only a switched-into account warrants the cue; the personal account is the
  // default and needs no banner.
  if (!account) {
    return null;
  }

  const displayName = getAccountDisplayName(account, locale);

  const handlePress = () => {
    showBottomSheet?.('AccountSwitcher');
  };

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: `${bloomTheme.colors.primary}14` }]}
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={
        t('accounts.activeAccount.a11y', { name: displayName })
        || `Active account: ${displayName}. Tap to switch accounts.`
      }
    >
      <View style={styles.content}>
        {account.avatar ? (
          <Image
            source={{ uri: oxyServices.getFileDownloadUrl(account.avatar, 'thumb') }}
            style={styles.avatar}
          />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: `${bloomTheme.colors.primary}30` }]}>
            <Text style={[styles.avatarText, { color: bloomTheme.colors.primary }]}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.textContainer}>
          <Text style={[styles.name, { color: bloomTheme.colors.primary }]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[styles.caption, { color: bloomTheme.colors.primary }]} numberOfLines={1}>
            {t('accounts.activeAccount.label') || 'Active account'}
          </Text>
        </View>
        <Ionicons name="chevron-down" size={18} color={bloomTheme.colors.primary} />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  avatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
  },
  textContainer: {
    flex: 1,
    marginLeft: 10,
  },
  name: {
    fontSize: 14,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
  },
  caption: {
    fontSize: 11,
    opacity: 0.8,
    marginTop: 1,
  },
});

export default React.memo(ActiveAccountBanner);
