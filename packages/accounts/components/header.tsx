import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, TextInput, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import type { DrawerNavigationProp } from '@react-navigation/drawer';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useScrollContext } from '@/contexts/scroll-context';
import { LogoIcon } from '@/assets/logo';
import { useOxy } from '@oxyhq/services';
import { getDisplayName } from '@/utils/date-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { darkenColor } from '@/utils/color-utils';
import * as Haptics from 'expo-haptics';

interface HeaderProps {
    searchQuery: string;
    onSearchChange: (text: string) => void;
    searchInputRef?: React.RefObject<TextInput | null>;
}

const DOUBLE_PRESS_DELAY = 300;
const HAPTIC_INTERVAL_MS = 40;
const HAPTIC_START_DELAY_MS = 100;
const HAPTIC_COMPLETION_DELAY_MS = 50;

const getHapticStyle = (intensity: number): Haptics.ImpactFeedbackStyle => {
    if (intensity <= 2) return Haptics.ImpactFeedbackStyle.Light;
    if (intensity <= 5) return intensity % 2 === 0
        ? Haptics.ImpactFeedbackStyle.Light
        : Haptics.ImpactFeedbackStyle.Medium;
    if (intensity <= 8) return Haptics.ImpactFeedbackStyle.Medium;
    if (intensity <= 12) return intensity % 2 === 0
        ? Haptics.ImpactFeedbackStyle.Medium
        : Haptics.ImpactFeedbackStyle.Heavy;
    return Haptics.ImpactFeedbackStyle.Heavy;
};

export function Header({ searchQuery, onSearchChange, searchInputRef }: HeaderProps) {
    const navigation = useNavigation<DrawerNavigationProp<any>>();
    const router = useRouter();
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const { isScrolled, scrollToTop } = useScrollContext();
    const isDesktop = Platform.OS === 'web' && width >= 768;

    const { user, oxyServices, showBottomSheet, isAuthenticated, refreshSessions } = useOxy();

    const lastPressRef = useRef<number>(0);
    const pressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hapticIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const hapticStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hapticIntensityRef = useRef<number>(0);
    const isLongPressActiveRef = useRef<boolean>(false);

    const displayName = useMemo(() => getDisplayName(user), [user]);
    const avatarUrl = useMemo(() => {
        if (user?.avatar && oxyServices) {
            return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
        }
        return undefined;
    }, [user?.avatar, oxyServices]);

    const stopHapticFeedback = useCallback(() => {
        // Clear the start timeout if it exists
        if (hapticStartTimeoutRef.current) {
            clearTimeout(hapticStartTimeoutRef.current);
            hapticStartTimeoutRef.current = null;
        }
        // Clear the haptic interval
        if (hapticIntervalRef.current) {
            clearInterval(hapticIntervalRef.current);
            hapticIntervalRef.current = null;
        }
        hapticIntensityRef.current = 0;
    }, []);

    const clearPressTimeout = useCallback(() => {
        if (pressTimeoutRef.current) {
            clearTimeout(pressTimeoutRef.current);
            pressTimeoutRef.current = null;
        }
        lastPressRef.current = 0;
    }, []);

    const handleSearchPress = useCallback(() => {
        router.push({ pathname: '/(tabs)/search', params: { q: '' } });
    }, [router]);

    const handleAvatarPress = useCallback(() => {
        showBottomSheet?.('AccountOverview');
    }, [showBottomSheet]);

    const handleMenuPress = useCallback(() => {
        try {
            if (navigation.openDrawer) {
                navigation.openDrawer();
            } else {
                navigation.dispatch(DrawerActions.openDrawer());
            }
        } catch (error) {
            console.error('Failed to open drawer:', error);
            navigation.dispatch(DrawerActions.openDrawer());
        }
    }, [navigation]);

    const handleLogoPress = useCallback(() => {
        const now = Date.now();
        const timeSinceLastPress = now - lastPressRef.current;

        if (lastPressRef.current && timeSinceLastPress < DOUBLE_PRESS_DELAY) {
            // Double press detected
            clearPressTimeout();
            scrollToTop();
            refreshSessions?.().catch(console.error);
        } else {
            // Single press - navigate to home after delay
            lastPressRef.current = now;
            pressTimeoutRef.current = setTimeout(() => {
                router.push('/(tabs)' as any);
                lastPressRef.current = 0;
            }, DOUBLE_PRESS_DELAY);
        }
    }, [router, scrollToTop, refreshSessions, clearPressTimeout]);

    const handleLogoLongPressStart = useCallback(() => {
        clearPressTimeout();
        stopHapticFeedback();
        isLongPressActiveRef.current = true;

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

        hapticStartTimeoutRef.current = setTimeout(() => {
            hapticIntervalRef.current = setInterval(() => {
                hapticIntensityRef.current += 1;
                Haptics.impactAsync(getHapticStyle(hapticIntensityRef.current));
            }, HAPTIC_INTERVAL_MS);
        }, HAPTIC_START_DELAY_MS);
    }, [clearPressTimeout, stopHapticFeedback]);

    const handleLogoLongPress = useCallback(() => {
        stopHapticFeedback();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setTimeout(() => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }, HAPTIC_COMPLETION_DELAY_MS);
        router.push('/(tabs)/easter-egg' as any);
    }, [router, stopHapticFeedback]);

    const handleLogoPressOut = useCallback(() => {
        if (isLongPressActiveRef.current) {
            isLongPressActiveRef.current = false;
            handleLogoLongPress();
        } else {
            stopHapticFeedback();
        }
    }, [handleLogoLongPress, stopHapticFeedback]);

    const handlePressIn = useHapticPress();

    const handleLogoPressIn = useCallback(() => {
        handlePressIn();
        // Don't start haptic feedback here - only start on actual long press
    }, [handlePressIn]);

    useEffect(() => {
        return stopHapticFeedback;
    }, [stopHapticFeedback]);

    const headerStyle = useMemo(() => [
        styles.header,
        {
            paddingTop: isDesktop ? 0 : insets.top + 4,
            paddingBottom: isDesktop ? 0 : 10,
            paddingHorizontal: isDesktop ? 16 : 10,
            borderBottomColor: colors.border,
            borderBottomWidth: isDesktop ? 0.5 : 0,
        },
    ], [insets.top, colors.border, isDesktop]);

    const searchBarBackgroundColor = useMemo(() =>
        colorScheme === 'dark' ? 'rgba(44, 44, 46, 0.7)' : 'rgba(248, 249, 250, 0.7)',
        [colorScheme]
    );

    const logoCenterStyle = useMemo(() => ({
        top: insets.top + 4,
    }), [insets.top]);

    const avatarSize = isDesktop ? 36 : 32;
    const avatarBorderRadius = avatarSize / 2;
    const avatarIconSize = isDesktop ? 20 : 18;

    return (
        <BlurView
            intensity={isScrolled ? 50 : 0}
            tint={colorScheme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={headerStyle}
        >
            <View style={[styles.topBarLeft, !isDesktop && styles.topBarLeftMobile]}>
                {!isDesktop && (
                    <TouchableOpacity
                        onPressIn={handlePressIn}
                        onPress={handleMenuPress}
                        style={styles.menuButton}
                    >
                        <Ionicons name="menu" size={24} color={colors.text} />
                    </TouchableOpacity>
                )}
                {isDesktop && (
                    <TouchableOpacity
                        onPressIn={handleLogoPressIn}
                        onPress={handleLogoPress}
                        onLongPress={handleLogoLongPressStart}
                        onPressOut={handleLogoPressOut}
                        activeOpacity={0.7}
                    >
                        <LogoIcon height={32} useThemeColors={true} />
                    </TouchableOpacity>
                )}
            </View>

            {isDesktop ? (
                <View style={styles.searchBarContainer}>
                    <View style={[styles.searchBar, {
                        backgroundColor: searchBarBackgroundColor,
                        borderColor: colors.border
                    }]}>
                        <Ionicons name="search-outline" size={20} color={colors.text} style={styles.searchIcon} />
                        <TextInput
                            ref={searchInputRef}
                            style={[styles.searchInput, { color: colors.text }]}
                            placeholder="Search Oxy Account"
                            placeholderTextColor={colors.secondaryText}
                            value={searchQuery}
                            onChangeText={onSearchChange}
                            returnKeyType="search"
                        />
                    </View>
                </View>
            ) : (
                <View style={[styles.logoCenter, logoCenterStyle]} pointerEvents="box-none">
                    <TouchableOpacity
                        onPressIn={handleLogoPressIn}
                        onPress={handleLogoPress}
                        onLongPress={handleLogoLongPressStart}
                        onPressOut={handleLogoPressOut}
                        activeOpacity={0.7}
                    >
                        <LogoIcon height={24} useThemeColors={true} />
                    </TouchableOpacity>
                </View>
            )}

            <View style={[styles.topBarRight, !isDesktop && styles.topBarRightMobile]}>
                {!isDesktop && (
                    <TouchableOpacity
                        style={styles.iconButton}
                        onPressIn={handlePressIn}
                        onPress={handleSearchPress}
                    >
                        <Ionicons name="search-outline" size={22} color={colors.text} />
                    </TouchableOpacity>
                )}
                <TouchableOpacity
                    onPressIn={handlePressIn}
                    onPress={handleAvatarPress}
                    activeOpacity={0.7}
                >
                    {isAuthenticated ? (
                        <UserAvatar name={displayName} imageUrl={avatarUrl} size={avatarSize} />
                    ) : (
                        <View style={[styles.userIconContainer, {
                            backgroundColor: colors.sidebarIconPersonalInfo,
                            width: avatarSize,
                            height: avatarSize,
                            borderRadius: avatarBorderRadius,
                        }]}>
                            <MaterialCommunityIcons
                                name="account-outline"
                                size={avatarIconSize}
                                color={darkenColor(colors.sidebarIconPersonalInfo)}
                            />
                        </View>
                    )}
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
                height: 64,
            },
        }),
    },
    menuButton: {
        padding: 6,
    },
    topBarLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    topBarLeftMobile: {
        flex: 1,
        justifyContent: 'flex-start',
    },
    logoCenter: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'box-none',
    },
    topBarRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    topBarRightMobile: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    iconButton: {
        padding: 6,
        borderRadius: 20,
    },
    userIconContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    searchBarContainer: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
    },
    searchBar: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 48,
        borderRadius: 24,
        paddingHorizontal: 16,
        gap: 12,
        maxWidth: 600,
        width: '100%',
        borderWidth: 0.5,
    },
    searchIcon: {
        opacity: 0.6,
    },
    searchInput: {
        flex: 1,
        fontSize: 16,
        padding: 0,
    },
});
