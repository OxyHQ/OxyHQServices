import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter, usePathname, type Href } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useTheme } from '@oxyhq/bloom/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { darkenColor } from '@/utils/color-utils';
import { useHapticPress } from '@/hooks/use-haptic-press';
import { useOxy } from '@oxyhq/services';
import { getAccountDisplayName } from '@oxyhq/core';
import type { MaterialCommunityIconName } from '@/types/icons';
import { useTranslation } from '@/lib/i18n';

// Narrow to the string variant of Href so menu items can be used as React
// keys and compared to `pathname` strings without casting.
type MenuPath = Extract<Href, string>;

export interface MenuItem {
    path: MenuPath;
    icon: MaterialCommunityIconName;
    /** Translation key under `drawer.*`. */
    labelKey: string;
    iconColor: string;
}

const baseMenuItems: MenuItem[] = [
    { path: '/(tabs)', icon: 'home-variant', labelKey: 'drawer.home', iconColor: 'sidebarIconHome' },
    { path: '/(tabs)/personal-info', icon: 'card-account-details-outline', labelKey: 'drawer.personalInfo', iconColor: 'sidebarIconPersonalInfo' },
    { path: '/(tabs)/about-identity', icon: 'shield-key', labelKey: 'drawer.aboutIdentity', iconColor: 'sidebarIconSecurity' },
    { path: '/(tabs)/security', icon: 'lock-outline', labelKey: 'drawer.security', iconColor: 'sidebarIconSecurity' },
    { path: '/(tabs)/activity', icon: 'pulse', labelKey: 'drawer.activity', iconColor: 'sidebarIconActivity' },
    { path: '/(tabs)/devices', icon: 'desktop-classic', labelKey: 'drawer.devices', iconColor: 'sidebarIconDevices' },
    { path: '/(tabs)/data', icon: 'toggle-switch-outline', labelKey: 'drawer.data', iconColor: 'sidebarIconData' },
    { path: '/(tabs)/sharing', icon: 'account-group-outline', labelKey: 'drawer.sharing', iconColor: 'sidebarIconSharing' },
    { path: '/(tabs)/managed-accounts', icon: 'account-supervisor-outline', labelKey: 'drawer.yourIdentities', iconColor: 'sidebarIconSharing' },
    { path: '/(tabs)/family', icon: 'share-variant-outline', labelKey: 'drawer.thirdParty', iconColor: 'sidebarIconFamily' },
    { path: '/(tabs)/payments', icon: 'wallet-outline', labelKey: 'drawer.payments', iconColor: 'sidebarIconPayments' },
    { path: '/(tabs)/storage', icon: 'cloud-outline', labelKey: 'drawer.storage', iconColor: 'sidebarIconStorage' },
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
    const { t, locale } = useTranslation();

    const handlePressIn = useHapticPress();
    const { actingAs, managedAccounts } = useOxy();

    // Compute the acting-as display name for the indicator using the canonical
    // helper so the fallback chain (name → username → publicKey → "Unnamed")
    // is identical across the app.
    const actingAsName = useMemo(() => {
        if (!actingAs || !managedAccounts.length) return null;
        const managed = managedAccounts.find((m) => m.accountId === actingAs);
        if (!managed?.account) return null;
        return getAccountDisplayName(managed.account, locale);
    }, [actingAs, managedAccounts, locale]);

    const handleNavigate = (path: MenuPath) => {
        router.push(path);
        onNavigate?.();
    };

    return (
        <>
            {/* Acting-as indicator */}
            {actingAs && actingAsName && (
                <View style={[styles.actingAsContainer, { backgroundColor: colors.sidebarIconSecurity + '14' }]}>
                    <View style={[styles.actingAsDot, { backgroundColor: colors.success }]} />
                    <Text style={[styles.actingAsText, { color: colors.sidebarIconSecurity }]} numberOfLines={1}>
                        {t('sidebar.actingAs', { name: actingAsName })}
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
                                {t(item.labelKey)}
                            </Text>
                        </>
                    );

                    return (
                        <TouchableOpacity
                            key={item.path}
                            onPressIn={handlePressIn}
                            onPress={() => handleNavigate(item.path)}
                            activeOpacity={0.7}
                            accessibilityRole="button"
                            accessibilityLabel={t(item.labelKey)}
                            accessibilityState={{ selected: isActive }}
                        >
                            <BlurView
                                intensity={isActive ? 80 : 50}
                                tint={mode === 'dark' ? 'dark' : 'light'}
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
