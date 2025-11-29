import React, { useMemo, useCallback } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useScrollContext } from '@/contexts/scroll-context';
import { useThemeContext } from '@/contexts/theme-context';
import { LogoIcon } from '@/assets/logo';
import { useOxy } from '@oxyhq/services';
import { getDisplayName } from '@/utils/date-utils';
import * as Haptics from 'expo-haptics';

export function MobileHeader() {
  const navigation = useNavigation();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { isScrolled } = useScrollContext();
  const { toggleColorScheme } = useThemeContext();

  // OxyServices integration
  const { user, oxyServices, showBottomSheet } = useOxy();

  // Compute user data
  const displayName = useMemo(() => getDisplayName(user), [user]);
  const avatarUrl = useMemo(() => {
    if (user?.avatar && oxyServices) {
      return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
    }
    return undefined;
  }, [user?.avatar, oxyServices]);

  const handleSearchPress = () => {
    router.push({
      pathname: '/(tabs)/search',
      params: { q: '' },
    });
  };

  const handleAvatarPress = () => {
    if (showBottomSheet) {
      showBottomSheet('AccountOverview');
    }
  };

  const handlePressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  return (
    <BlurView
      intensity={isScrolled ? 50 : 0}
      tint={colorScheme === 'dark' ? 'dark' : 'light'}
      experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
      style={[
        styles.header,
        {
          paddingTop: insets.top + 16,
          paddingBottom: 16,
          paddingHorizontal: 16,
        },
      ]}
    >
      <View style={styles.headerLeft}>
        <TouchableOpacity
          onPressIn={handlePressIn}
          onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
          style={styles.menuButton}
        >
          <MaterialIcons name="menu" size={28} color={colors.text} />
        </TouchableOpacity>
        <LogoIcon height={28} useThemeColors={true} />
      </View>
      <View style={styles.headerRight}>
        <TouchableOpacity style={styles.iconButton} onPressIn={handlePressIn} onPress={handleSearchPress}>
          <MaterialIcons name="search" size={26} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPressIn={handlePressIn} onPress={toggleColorScheme}>
          <MaterialIcons name={colorScheme === 'dark' ? 'light-mode' : 'dark-mode'} size={26} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity onPressIn={handlePressIn} onPress={handleAvatarPress} activeOpacity={0.7}>
          <UserAvatar name={displayName} imageUrl={avatarUrl} size={36} />
        </TouchableOpacity>
      </View>
    </BlurView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        position: 'sticky' as any,
      },
    }),
  },
  menuButton: {
    padding: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    padding: 8,
    borderRadius: 20,
  },
});

