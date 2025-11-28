import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { SidebarContent } from './sidebar-content';

export function DrawerContent(props: DrawerContentComponentProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    return (
        <BlurView
            intensity={50}
            tint={colorScheme === 'dark' ? 'dark' : 'light'}
            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            style={styles.blurContainer}
        >
            <View style={styles.darkOverlay} />
            <DrawerContentScrollView
                {...props}
                contentContainerStyle={styles.drawerContent}
                style={styles.scrollView}
            >
                <SidebarContent onNavigate={() => props.navigation.closeDrawer()} />
            </DrawerContentScrollView>
        </BlurView>
    );
}

const styles = StyleSheet.create({
    blurContainer: {
        flex: 1,
        overflow: 'hidden',
    },
    darkOverlay: {
        ...StyleSheet.absoluteFillObject,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
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

