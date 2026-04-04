import React, { useMemo } from 'react';
import { View, StyleSheet, Platform, type ColorValue } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { useTheme } from '@oxyhq/bloom/theme';
import { DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { SidebarContent } from './sidebar-content';

export function DrawerContent(props: DrawerContentComponentProps) {
    const colors = useColors();
    const { mode } = useTheme();

    const gradientColors = useMemo((): readonly [ColorValue, ColorValue, ColorValue] => {
        if (mode === 'dark') {
            return ['rgba(0, 0, 0, 0.9)', 'rgba(0, 0, 0, 0.5)', 'transparent'] as const;
        } else {
            return ['rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.5)', 'transparent'] as const;
        }
    }, [mode]);

    return (
        <View style={styles.container}>
            <LinearGradient
                colors={gradientColors}
                locations={[0, 0.6, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={StyleSheet.absoluteFill}
            />
            <DrawerContentScrollView
                {...props}
                contentContainerStyle={styles.drawerContent}
                style={styles.scrollView}
            >
                <SidebarContent onNavigate={() => props.navigation.closeDrawer()} />
            </DrawerContentScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    scrollView: {
        backgroundColor: 'transparent',
    },
    drawerContent: {
        flex: 1,
        padding: 16,
        justifyContent: 'center',
    },
});

