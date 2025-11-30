import React, { useMemo, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, TextInput, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { useNavigation, DrawerActions } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from '@/components/user-avatar';
import { useScrollContext } from '@/contexts/scroll-context';
import { LogoIcon } from '@/assets/logo';
import { useOxy } from '@oxyhq/services';
import { getDisplayName } from '@/utils/date-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';

interface HeaderProps {
    searchQuery: string;
    onSearchChange: (text: string) => void;
    searchInputRef?: React.RefObject<TextInput | null>;
}

export function Header({ searchQuery, onSearchChange, searchInputRef }: HeaderProps) {
    const navigation = useNavigation();
    const router = useRouter();
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];
    const insets = useSafeAreaInsets();
    const { width } = useWindowDimensions();
    const { isScrolled } = useScrollContext();
    const isDesktop = Platform.OS === 'web' && width >= 768;

    const { user, oxyServices, showBottomSheet } = useOxy();

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

    const handleMenuPress = () => {
        navigation.dispatch(DrawerActions.openDrawer());
    };

    const handlePressIn = useHapticPress();

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

    return (
        <BlurView
            intensity={isScrolled ? 50 : 0}
            tint={colorScheme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={headerStyle}
        >
            <View style={[styles.topBarLeft, !isDesktop && { flex: 1, justifyContent: 'flex-start' }]}>
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
                    <LogoIcon height={32} useThemeColors={true} />
                )}
            </View>

            {isDesktop ? (
                <View style={styles.searchBarContainer}>
                    <View style={[styles.searchBar, { backgroundColor: colorScheme === 'dark' ? 'rgba(44, 44, 46, 0.7)' : 'rgba(248, 249, 250, 0.7)', borderColor: colors.border }]}>
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
                <View style={styles.logoCenter}>
                    <LogoIcon height={24} useThemeColors={true} />
                </View>
            )}

            <View style={[styles.topBarRight, !isDesktop && { flex: 1, justifyContent: 'flex-end' }]}>
                {!isDesktop && (
                    <TouchableOpacity style={styles.iconButton} onPressIn={handlePressIn} onPress={handleSearchPress}>
                        <Ionicons name="search-outline" size={22} color={colors.text} />
                    </TouchableOpacity>
                )}
                <TouchableOpacity onPressIn={handlePressIn} onPress={handleAvatarPress} activeOpacity={0.7}>
                    <UserAvatar name={displayName} imageUrl={avatarUrl} size={isDesktop ? 36 : 32} />
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
    logoCenter: {
        position: 'absolute',
        left: 0,
        right: 0,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: -1,
    },
    topBarRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    iconButton: {
        padding: 6,
        borderRadius: 20,
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

