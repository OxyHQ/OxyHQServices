import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';

export interface MenuItem {
    path: string;
    icon: string;
    label: string;
    iconColor: string;
}

export const menuItems: MenuItem[] = [
    { path: '/(tabs)', icon: 'home-variant', label: 'Home', iconColor: 'sidebarIconHome' },
    { path: '/(tabs)/personal-info', icon: 'card-account-details-outline', label: 'Personal info', iconColor: 'sidebarIconPersonalInfo' },
    { path: '/(tabs)/security', icon: 'lock-outline', label: 'Security & sign-in', iconColor: 'sidebarIconSecurity' },
    { path: '/(tabs)/password-manager', icon: 'key-outline', label: 'Password Manager', iconColor: 'sidebarIconPassword' },
    { path: '/(tabs)/devices', icon: 'desktop-classic', label: 'Your devices', iconColor: 'sidebarIconDevices' },
    { path: '/(tabs)/data', icon: 'toggle-switch-outline', label: 'Data & privacy', iconColor: 'sidebarIconData' },
    { path: '/(tabs)/sharing', icon: 'account-group-outline', label: 'People & sharing', iconColor: 'sidebarIconSharing' },
    { path: '/(tabs)/family', icon: 'home-group', label: 'Family Group', iconColor: 'sidebarIconFamily' },
    { path: '/(tabs)/payments', icon: 'wallet-outline', label: 'Payments & subscriptions', iconColor: 'sidebarIconPayments' },
    { path: '/(tabs)/storage', icon: 'cloud-outline', label: 'Oxy storage', iconColor: 'sidebarIconStorage' },
];

interface SidebarContentProps {
    onNavigate?: () => void;
}

export function SidebarContent({ onNavigate }: SidebarContentProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const router = useRouter();
    const pathname = usePathname();

    const handleNavigate = (path: string) => {
        router.push(path as any);
        onNavigate?.();
    };

    return (
        <>
            <View style={styles.sidebarHeader}>
                <ThemedText style={styles.welcomeText}>Welcome, Nate.</ThemedText>
                <ThemedText style={styles.welcomeSubtext}>Manage your Oxy account.</ThemedText>
            </View>

            <View style={styles.menuContainer}>
                {menuItems.map((item) => {
                    const isActive = pathname === item.path || (item.path === '/(tabs)' && (pathname === '/(tabs)' || pathname === '/(tabs)/'));
                    const iconColor = colors[item.iconColor as keyof typeof colors] as string;

                    return (
                        <TouchableOpacity
                            key={item.path}
                            style={[
                                styles.menuItem,
                                isActive ? styles.menuItemActive : null,
                                { backgroundColor: isActive ? colors.sidebarItemActiveBackground : 'transparent' }
                            ]}
                            onPress={() => handleNavigate(item.path)}
                        >
                            <View style={[styles.menuIconContainer, { backgroundColor: iconColor }]}>
                                <MaterialCommunityIcons name={item.icon as any} size={22} color={darkenColor(iconColor)} />
                            </View>
                            <Text style={[styles.menuItemText, { color: isActive ? colors.sidebarItemActiveText : colors.text }]}>
                                {item.label}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    sidebarHeader: {
        marginBottom: 24,
        paddingLeft: 12, // Match menuItem paddingHorizontal
    },
    welcomeText: {
        fontSize: 24,
        fontWeight: '600',
        marginBottom: 8,
        lineHeight: 32,
    },
    welcomeSubtext: {
        fontSize: 24,
        opacity: 0.6,
        lineHeight: 32,
    },
    menuContainer: {
        gap: 4,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 26,
        gap: 12,
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

