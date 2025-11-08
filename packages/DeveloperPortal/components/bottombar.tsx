import React from 'react';
import { View, StyleSheet, TouchableOpacity, Text, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function BottomBar() {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const router = useRouter();
    const pathname = usePathname();
    const insets = useSafeAreaInsets();

    // Only show on mobile
    if (Platform.OS === 'web') {
        return null;
    }

    const tabs = [
        { id: 'apps', icon: 'apps', label: 'Apps', path: '/' },
        { id: 'docs', icon: 'book', label: 'Docs', path: '/explore' },
        { id: 'settings', icon: 'settings', label: 'Settings', path: '/settings' },
    ];

    const isActive = (path: string) => {
        if (path === '/') {
            return pathname === '/' || pathname === '/index';
        }
        return pathname?.startsWith(path);
    };

    return (
        <View
            style={[
                styles.container,
                {
                    backgroundColor: colors.card,
                    borderTopColor: colors.border,
                    paddingBottom: insets.bottom || 8,
                },
            ]}
        >
            {tabs.map((tab) => (
                <TouchableOpacity
                    key={tab.id}
                    style={styles.tab}
                    onPress={() => router.push(tab.path as any)}
                    activeOpacity={0.7}
                >
                    <Ionicons
                        name={tab.icon as any}
                        size={24}
                        color={isActive(tab.path) ? colors.tint : colors.icon}
                    />
                    <Text
                        style={[
                            styles.tabLabel,
                            { color: isActive(tab.path) ? colors.tint : colors.icon },
                        ]}
                    >
                        {tab.label}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        borderTopWidth: 1,
        paddingTop: 8,
        paddingHorizontal: 8,
    },
    tab: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 8,
        gap: 4,
    },
    tabLabel: {
        fontSize: 11,
        fontWeight: '600',
    },
});
