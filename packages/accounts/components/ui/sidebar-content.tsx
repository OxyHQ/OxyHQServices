import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter, usePathname } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useTheme } from '@oxyhq/bloom/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useOxy } from '@oxyhq/services';
import type { MaterialCommunityIconName } from '@/types/icons';

export interface MenuItem {
    path: string;
    icon: MaterialCommunityIconName;
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
    { path: '/(tabs)/managed-accounts', icon: 'account-supervisor-outline', label: 'Your Identities', iconColor: 'sidebarIconSharing' },
    { path: '/(tabs)/family', icon: 'share-variant-outline', label: 'Third-party connections', iconColor: 'sidebarIconFamily' },
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
    const colors = useColors();
    const { mode } = useTheme();
    const router = useRouter();
    const pathname = usePathname();

    const handlePressIn = useHapticPress();
    const { actingAs, managedAccounts } = useOxy();

    // Compute the acting-as display name for the indicator
    const actingAsName = useMemo(() => {
        if (!actingAs || !managedAccounts.length) return null;
        const managed = managedAccounts.find((m) => m.accountId === actingAs);
        if (!managed?.account) return null;
        const account = managed.account;
        if (typeof account.name === 'object' && account.name) {
            const nameObj = account.name as { first?: string; full?: string };
            if (nameObj.full) return nameObj.full;
            if (nameObj.first) return nameObj.first;
        }
        if (typeof account.name === 'string' && account.name) return account.name;
        return account.username || 'Managed Account';
    }, [actingAs, managedAccounts]);

    const handleNavigate = (path: string) => {
        router.push(path as any);
        onNavigate?.();
    };

    return (
        <>
            {/* Acting-as indicator */}
            {actingAs && actingAsName && (
                <View style={[styles.actingAsContainer, { backgroundColor: colors.sidebarIconSecurity + '14' }]}>
                    <View style={[styles.actingAsDot, { backgroundColor: colors.success }]} />
                    <Text style={[styles.actingAsText, { color: colors.sidebarIconSecurity }]} numberOfLines={1}>
                        Acting as {actingAsName}
                    </Text>
                </View>
            )}
            <View style={styles.menuContainer}>
                {menuItems.map((item) => {
                    const isActive = pathname === item.path || (item.path === '/(tabs)' && (pathname === '/(tabs)' || pathname === '/(tabs)/'));
                    const iconColor = colors[item.iconColor as keyof typeof colors] as string;

                    const menuItemContent = (
                        <>
                            <View style={[styles.menuIconContainer, { backgroundColor: iconColor }]}>
                                <MaterialCommunityIcons name={item.icon} size={22} color={darkenColor(iconColor)} />
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
                                tint={mode === 'dark' ? 'dark' : 'light'}
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
    actingAsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 20,
        marginBottom: 12,
        gap: 8,
        alignSelf: 'flex-start',
    },
    actingAsDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
    },
    actingAsText: {
        fontSize: 13,
        fontWeight: '500',
    },
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
