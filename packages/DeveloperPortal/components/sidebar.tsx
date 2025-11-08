import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform, ViewStyle, Dimensions } from 'react-native';
import { Pressable } from 'react-native-web-hover';
import { useRouter, usePathname } from 'expo-router';
import { ThemedView } from './themed-view';
import { ThemedText } from './themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from './user-avatar';
import { useOxy } from '@oxyhq/services';

const WindowHeight = Dimensions.get('window').height;

export function SideBar() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const router = useRouter();
    const pathname = usePathname();
    const { user, isAuthenticated, showBottomSheet } = useOxy();

    // Only show on web
    if (Platform.OS !== 'web') {
        return null;
    }

    const [isExpanded, setIsExpanded] = React.useState(false);
    const hoverCollapseTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleHoverIn = React.useCallback(() => {
        if (hoverCollapseTimeout.current) {
            clearTimeout(hoverCollapseTimeout.current);
            hoverCollapseTimeout.current = null;
        }
        setIsExpanded(true);
    }, []);

    const handleHoverOut = React.useCallback(() => {
        if (hoverCollapseTimeout.current) {
            clearTimeout(hoverCollapseTimeout.current);
        }
        hoverCollapseTimeout.current = setTimeout(() => setIsExpanded(false), 200);
    }, []);

    const menuItems = [
        { id: 'apps', icon: 'apps', label: 'Apps', path: '/' },
        { id: 'docs', icon: 'book', label: 'Documentation', path: '/explore' },
        { id: 'settings', icon: 'settings', label: 'Settings', path: '/settings' },
    ];

    const isActive = (path: string) => {
        if (path === '/') {
            return pathname === '/' || pathname === '/index';
        }
        return pathname?.startsWith(path);
    };

    const SideBarItem = ({
        icon,
        label,
        onPress,
        active,
    }: {
        icon: string;
        label: string;
        onPress: () => void;
        active: boolean;
    }) => (
        <Pressable
            {...({ onHoverIn: handleHoverIn } as any)}
            onPress={onPress}
            style={[
                styles.navItem,
                active && { backgroundColor: colors.card },
                {
                    width: isExpanded ? '100%' : 48,
                    ...(Platform.select({
                        web: {
                            transition: 'width 220ms cubic-bezier(0.2, 0, 0, 1), background-color 200ms',
                            willChange: 'width, background-color',
                        },
                    }) as ViewStyle),
                },
            ]}
        >
            <Ionicons
                name={icon as any}
                size={20}
                color={active ? colors.text : colors.icon}
            />
            <Text
                style={[
                    styles.navItemText,
                    { color: active ? colors.text : colors.icon },
                    {
                        opacity: isExpanded ? 1 : 0,
                        width: isExpanded ? 'auto' : 0,
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        ...(Platform.select({
                            web: {
                                transition: 'opacity 220ms cubic-bezier(0.2, 0, 0, 1), width 220ms cubic-bezier(0.2, 0, 0, 1)',
                                willChange: 'opacity, width',
                            },
                        }) as any),
                    },
                ]}
            >
                {label}
            </Text>
        </Pressable>
    );

    return (
        <Pressable
            {...({ onHoverIn: handleHoverIn, onHoverOut: handleHoverOut } as any)}
            style={[
                styles.container,
                {
                    backgroundColor: colors.background,
                    width: isExpanded ? 240 : 60,
                    ...(Platform.select({
                        web: {
                            transition: 'width 220ms cubic-bezier(0.2, 0, 0, 1)',
                            willChange: 'width',
                        },
                    }) as ViewStyle),
                },
            ]}
        >
            <View style={styles.inner}>
                <View style={styles.headerSection}>
                    <View style={styles.logoContainer}>
                        <Ionicons name="code-slash" size={28} color={colors.tint} />
                        <Text
                            style={[
                                styles.logoText,
                                { color: colors.text },
                                {
                                    opacity: isExpanded ? 1 : 0,
                                    width: isExpanded ? 'auto' : 0,
                                    overflow: 'hidden',
                                    whiteSpace: 'nowrap',
                                    ...(Platform.select({
                                        web: {
                                            transition: 'opacity 220ms cubic-bezier(0.2, 0, 0, 1), width 220ms cubic-bezier(0.2, 0, 0, 1)',
                                            willChange: 'opacity, width',
                                        },
                                    }) as any),
                                },
                            ]}
                        >
                            Developer
                        </Text>
                    </View>
                </View>

                <View style={styles.navigationSection}>
                    {menuItems.map((item) => (
                        <SideBarItem
                            key={item.id}
                            icon={item.icon}
                            label={item.label}
                            onPress={() => router.push(item.path as any)}
                            active={isActive(item.path)}
                        />
                    ))}
                </View>

                <View style={styles.footer}>
                    {isAuthenticated && user ? (
                        <SideBarItem
                            icon="log-out-outline"
                            label="Sign Out"
                            onPress={() => showBottomSheet?.('AccountOverview')}
                            active={false}
                        />
                    ) : (
                        <SideBarItem
                            icon="log-in-outline"
                            label="Sign In"
                            onPress={() => showBottomSheet?.('SignIn')}
                            active={false}
                        />
                    )}
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        padding: 6,
        ...(Platform.select({
            web: {
                position: 'sticky' as any,
                overflow: 'hidden',
                height: '100vh' as any,
                cursor: 'initial',
            },
            default: {
                height: WindowHeight,
            },
        }) as ViewStyle),
        top: 0,
        zIndex: 1000,
    },
    inner: {
        flex: 1,
        width: '100%',
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
    },
    headerSection: {
        marginBottom: 16,
    },
    logoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingLeft: 8,
    },
    logoText: {
        fontSize: 20,
        fontWeight: '700',
    },
    navigationSection: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'flex-start',
        width: '100%',
        gap: 2,
    },
    navItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 12,
        borderRadius: 100,
        gap: 16,
        alignSelf: 'flex-start',
    },
    navItemText: {
        fontSize: 16,
        fontWeight: '500',
    },
    footer: {
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        width: '100%',
        marginTop: 'auto',
    },
});