import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { ThemedView } from './themed-view';
import { ThemedText } from './themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { UserAvatar } from './user-avatar';
import { useOxy } from '@oxyhq/services';

export function SideBar() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const router = useRouter();
    const pathname = usePathname();
    const { user } = useOxy();

    // Only show on web
    if (Platform.OS !== 'web') {
        return null;
    }

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

    return (
        <ThemedView style={[styles.container, { borderRightColor: colors.border }]}>
            <View style={styles.header}>
                <View style={styles.logoContainer}>
                    <Ionicons name="code-slash" size={32} color={colors.tint} />
                    <ThemedText style={styles.logoText}>Developer</ThemedText>
                </View>
            </View>

            <View style={styles.nav}>
                {menuItems.map((item) => (
                    <TouchableOpacity
                        key={item.id}
                        style={[
                            styles.navItem,
                            isActive(item.path) && { backgroundColor: colors.card },
                        ]}
                        onPress={() => router.push(item.path as any)}
                    >
                        <Ionicons
                            name={item.icon as any}
                            size={20}
                            color={isActive(item.path) ? colors.text : colors.icon}
                        />
                        <Text
                            style={[
                                styles.navItemText,
                                { color: isActive(item.path) ? colors.text : colors.icon },
                            ]}
                        >
                            {item.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {user && (
                <View style={styles.footer}>
                    <View style={styles.userInfo}>
                        <UserAvatar size={40} />
                        <View style={styles.userDetails}>
                            <ThemedText style={styles.userName}>{user.username}</ThemedText>
                            <ThemedText style={styles.userEmail}>{user.email}</ThemedText>
                        </View>
                    </View>
                </View>
            )}
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 260,
        borderRightWidth: 0.5,
        padding: 20,
    },
    header: {
        marginBottom: 32,
    },
    logoContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    logoText: {
        fontSize: 20,
        fontWeight: '700',
    },
    nav: {
        flex: 1,
        gap: 4,
    },
    navItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 8,
        gap: 12,
    },
    navItemText: {
        fontSize: 15,
        fontWeight: '500',
    },
    footer: {
        paddingTop: 20,
        borderTopWidth: 0.5,
        borderTopColor: 'rgba(128, 128, 128, 0.2)',
    },
    userInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    userDetails: {
        flex: 1,
    },
    userName: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 2,
    },
    userEmail: {
        fontSize: 12,
        opacity: 0.6,
    },
});
