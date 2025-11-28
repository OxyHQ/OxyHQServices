import React from 'react';
import { View, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useScrollContext } from '@/contexts/scroll-context';

export function MobileHeader() {
  const navigation = useNavigation();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { isScrolled } = useScrollContext();

  const toggleColorScheme = () => {
    // This would toggle between light and dark mode
    // You'd need to implement this based on your theme system
  };

  const handleSearchPress = () => {
    router.push({
      pathname: '/(tabs)/search',
      params: { q: '' },
    });
  };

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
      <TouchableOpacity
        onPress={() => navigation.dispatch(DrawerActions.openDrawer())}
        style={styles.menuButton}
      >
        <MaterialCommunityIcons name="menu" size={24} color={colors.text} />
      </TouchableOpacity>
      <View style={styles.headerRight}>
        <TouchableOpacity style={styles.iconButton} onPress={handleSearchPress}>
          <MaterialCommunityIcons name="magnify" size={22} color={colors.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={toggleColorScheme}>
          <MaterialCommunityIcons name={colorScheme === 'dark' ? 'weather-sunny' : 'weather-night'} size={22} color={colors.text} />
        </TouchableOpacity>
        <UserAvatar name="Nate Isern Alvarez" size={36} />
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

