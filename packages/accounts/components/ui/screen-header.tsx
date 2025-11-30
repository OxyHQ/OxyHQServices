import React from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface ScreenHeaderProps {
    title: string;
    subtitle?: string;
    style?: any;
}

export function ScreenHeader({ title, subtitle, style }: ScreenHeaderProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const { width } = useWindowDimensions();
    const colors = Colors[colorScheme];
    const isDesktop = Platform.OS === 'web' && width >= 768;

    return (
        <View style={[isDesktop ? styles.desktopHeader : styles.mobileHeader, style]}>
            <ThemedText style={isDesktop ? styles.title : styles.mobileTitle}>
                {title}
            </ThemedText>
            {subtitle && (
                <ThemedText style={isDesktop ? styles.subtitle : styles.mobileSubtitle}>
                    {subtitle}
                </ThemedText>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    desktopHeader: {
        marginBottom: 24,
    },
    mobileHeader: {
        marginBottom: 20,
    },
    title: {
        fontSize: 32,
        fontWeight: '600',
        marginBottom: 12,
    },
    subtitle: {
        fontSize: 16,
        opacity: 0.7,
    },
    mobileTitle: {
        fontSize: 28,
        fontWeight: '600',
        marginBottom: 10,
    },
    mobileSubtitle: {
        fontSize: 15,
        opacity: 0.6,
    },
});

