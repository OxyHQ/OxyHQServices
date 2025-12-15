import React, { useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { SidebarContent } from './sidebar-content';

export function DrawerContent(props: DrawerContentComponentProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const gradientColors = useMemo(() => {
        if (colorScheme === 'dark') {
            return ['rgba(0, 0, 0, 0.9)', 'rgba(0, 0, 0, 0.5)', 'transparent'];
        } else {
            return ['rgba(255, 255, 255, 0.9)', 'rgba(255, 255, 255, 0.5)', 'transparent'];
        }
    }, [colorScheme]);

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

