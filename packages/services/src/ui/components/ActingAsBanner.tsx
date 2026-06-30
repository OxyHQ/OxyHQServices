import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Image,
} from 'react-native';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';
import { getAccountDisplayName } from '@oxyhq/core';
import { useI18n } from '../hooks/useI18n';

/**
 * ActingAsBanner - Shows a subtle banner when the caller is acting as another
 * account from the account graph (delegated identity via `X-Acting-As`).
 *
 * - Tap to open the unified {@link AccountSwitcher}.
 * - Long-press to switch back to the personal account immediately.
 *
 * Place this component in your app's layout where you want the banner to appear
 * (typically at the top of the screen or below the header). The "identity"
 * here is the Account, NOT the cryptographic Commons/DID identity.
 */
const ActingAsBanner: React.FC = () => {
  const bloomTheme = useTheme();
  const { actingAs, actingAsAccount, setActingAs, showBottomSheet, oxyServices } = useOxy();
  const { t, locale } = useI18n();

  const account = actingAsAccount?.account ?? null;

  if (!actingAs || !account) {
    return null;
  }

  const displayName = getAccountDisplayName(account, locale);

  const handlePress = () => {
    showBottomSheet?.('AccountSwitcher');
  };

  const handleLongPress = () => {
    setActingAs(null);
  };

  const label = t('accounts.actingAs.label', { name: displayName }) || `Acting as ${displayName}`;
  const switchBack = t('accounts.actingAs.switchBack') || 'Switch back';

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: `${bloomTheme.colors.primary}14` }]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={
        t('accounts.actingAs.a11y', { name: displayName })
        || `Acting as ${displayName}. Tap to switch accounts, long press to switch back.`
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
          <Text style={[styles.label, { color: bloomTheme.colors.primary }]} numberOfLines={1}>
            {label}
          </Text>
        </View>
        <View style={[styles.switchBackHint, { borderColor: `${bloomTheme.colors.primary}40` }]}>
          <Text style={[styles.switchBackText, { color: bloomTheme.colors.primary }]}>
            {switchBack}
          </Text>
        </View>
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
  label: {
    fontSize: 14,
    fontWeight: Platform.OS === 'web' ? '500' : undefined,
  },
  switchBackHint: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  switchBackText: {
    fontSize: 12,
    fontWeight: Platform.OS === 'web' ? '500' : undefined,
  },
});

export default React.memo(ActingAsBanner);
