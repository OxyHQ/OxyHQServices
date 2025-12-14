import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter, usePathname } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';

export interface MenuItem {
    path: string;
    icon: string;
    label: string;
    iconColor: string;
}

const baseMenuItems: MenuItem[] = [
    { path: '/(tabs)', icon: 'home-variant', label: 'Home', iconColor: 'sidebarIconHome' },
    { path: '/(tabs)/personal-info', icon: 'card-account-details-outline', label: 'Personal info', iconColor: 'sidebarIconPersonalInfo' },
    { path: '/(tabs)/about-identity', icon: 'shield-key', label: 'About Your Identity', iconColor: 'sidebarIconSecurity' },
    { path: '/(tabs)/security', icon: 'lock-outline', label: 'Security & sign-in', iconColor: 'sidebarIconSecurity' },
    { path: '/(tabs)/devices', icon: 'desktop-classic', label: 'Your devices', iconColor: 'sidebarIconDevices' },
    { path: '/(tabs)/data', icon: 'toggle-switch-outline', label: 'Data & privacy', iconColor: 'sidebarIconData' },
    { path: '/(tabs)/sharing', icon: 'account-group-outline', label: 'People & sharing', iconColor: 'sidebarIconSharing' },
    { path: '/(tabs)/family', icon: 'home-group', label: 'Family Group', iconColor: 'sidebarIconFamily' },
    { path: '/(tabs)/payments', icon: 'wallet-outline', label: 'Payments & subscriptions', iconColor: 'sidebarIconPayments' },
    { path: '/(tabs)/storage', icon: 'cloud-outline', label: 'Oxy storage', iconColor: 'sidebarIconStorage' },
];

// Filter menu items based on platform - about-identity only on native
export const menuItems: MenuItem[] = baseMenuItems.filter(item => {
    if (item.path === '/(tabs)/about-identity') {
        return Platform.OS !== 'web';
    }
    return true;
});

interface SidebarContentProps {
    onNavigate?: () => void;
}

export function SidebarContent({ onNavigate }: SidebarContentProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const router = useRouter();
    const pathname = usePathname();

    const handlePressIn = useHapticPress();

    const handleNavigate = (path: string) => {
        router.push(path as any);
        onNavigate?.();
    };

    return (
        <>
            <View style={styles.menuContainer}>
                {menuItems.map((item) => {
                    const isActive = pathname === item.path || (item.path === '/(tabs)' && (pathname === '/(tabs)' || pathname === '/(tabs)/'));
                    const iconColor = colors[item.iconColor as keyof typeof colors] as string;

                    const menuItemContent = (
                        <>
                            <View style={[styles.menuIconContainer, { backgroundColor: iconColor }]}>
                                <MaterialCommunityIcons name={item.icon as any} size={22} color={darkenColor(iconColor)} />
                            </View>
                            <Text style={[styles.menuItemText, { color: isActive ? colors.sidebarItemActiveText : colors.text }]}>
                                {item.label}
                            </Text>
                        </>
                    );

                    return (
                        <TouchableOpacity
                            key={item.path}
                            onPressIn={handlePressIn}
                            onPress={() => handleNavigate(item.path)}
                            activeOpacity={0.7}
                        >
                            <BlurView
                                intensity={isActive ? 80 : 50}
                                tint={colorScheme === 'dark' ? 'dark' : 'light'}
                                experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
                                style={[
                                    styles.menuItem,
                                    isActive ? styles.menuItemActive : null,
                                    { backgroundColor: isActive ? colors.sidebarItemActiveBackground : 'rgba(255, 255, 255, 0.1)' }
                                ]}
                            >
                                {menuItemContent}
                            </BlurView>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    menuContainer: {
        gap: 4,
        alignItems: 'flex-start',
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingLeft: 12,
        paddingRight: 24,
        borderRadius: 26,
        gap: 12,
        overflow: 'hidden',
        alignSelf: 'flex-start',
    },
    menuItemActive: {},
    menuIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    menuItemText: {
        fontSize: 14,
        fontWeight: '400',
    },
});

