import React from 'react';
import { StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { DrawerContentScrollView, DrawerContentComponentProps } from '@react-navigation/drawer';
import { SidebarContent } from './sidebar-content';

export function DrawerContent(props: DrawerContentComponentProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    return (
        <DrawerContentScrollView
            {...props}
            contentContainerStyle={[styles.drawerContent, { backgroundColor: colors.background }]}
        >
            <SidebarContent onNavigate={() => props.navigation.closeDrawer()} />
        </DrawerContentScrollView>
    );
}

const styles = StyleSheet.create({
    drawerContent: {
        flex: 1,
        padding: 16,
    },
});

