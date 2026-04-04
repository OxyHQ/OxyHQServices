import React, { useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Image,
} from 'react-native';
import { fontFamilies } from '../styles/fonts';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';

/**
 * ActingAsBanner - Shows a subtle banner when the user is acting as a managed account.
 *
 * - Tap to open the AccountSwitcher screen.
 * - Long-press to switch back to the primary account immediately.
 *
 * Place this component in your app's layout where you want the banner to appear
 * (typically at the top of the screen or below the header).
 */
const ActingAsBanner: React.FC = () => {
  const bloomTheme = useTheme();
  const { actingAs, managedAccounts, setActingAs, showBottomSheet, oxyServices } = useOxy();

  const activeAccount = useMemo(() => {
    if (!actingAs || !managedAccounts.length) return null;
    const managed = managedAccounts.find((m) => m.accountId === actingAs);
    return managed?.account ?? null;
  }, [actingAs, managedAccounts]);

  if (!actingAs || !activeAccount) {
    return null;
  }

  const displayName =
    typeof activeAccount.name === 'object'
      ? activeAccount.name.full || activeAccount.name.first || activeAccount.username
      : activeAccount.name || activeAccount.username;

  const handlePress = () => {
    showBottomSheet?.('AccountSwitcher');
  };

  const handleLongPress = () => {
    setActingAs(null);
  };

  return (
    <TouchableOpacity
      style={[styles.container, { backgroundColor: bloomTheme.colors.primary + '14' }]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Acting as ${displayName}. Tap to switch accounts, long press to switch back.`}
    >
      <View style={styles.content}>
        {activeAccount.avatar ? (
          <Image
            source={{ uri: oxyServices.getFileDownloadUrl(activeAccount.avatar, 'thumb') }}
            style={styles.avatar}
          />
        ) : (
          <View style={[styles.avatarFallback, { backgroundColor: bloomTheme.colors.primary + '30' }]}>
            <Text style={[styles.avatarText, { color: bloomTheme.colors.primary }]}>
              {displayName.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.textContainer}>
          <Text style={[styles.label, { color: bloomTheme.colors.primary }]} numberOfLines={1}>
            Acting as {displayName}
          </Text>
        </View>
        <View style={[styles.switchBackHint, { borderColor: bloomTheme.colors.primary + '40' }]}>
          <Text style={[styles.switchBackText, { color: bloomTheme.colors.primary }]}>
            Switch back
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
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
  },
  textContainer: {
    flex: 1,
    marginLeft: 10,
  },
  label: {
    fontSize: 14,
    fontFamily: fontFamilies.interMedium,
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
    fontFamily: fontFamilies.interMedium,
    fontWeight: Platform.OS === 'web' ? '500' : undefined,
  },
});

export default React.memo(ActingAsBanner);
