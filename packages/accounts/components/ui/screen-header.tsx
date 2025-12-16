import React from 'react';
import { View, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { ThemedText } from '@/components/themed-text';

interface ScreenHeaderProps {
    title: string;
    subtitle?: string;
    style?: any;
}

export function ScreenHeader({ title, subtitle, style }: ScreenHeaderProps) {
    const { width } = useWindowDimensions();
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
        paddingTop: 24,
        gap: 24,
    },
    mobileHeader: {
        marginBottom: 20,
        paddingTop: 24,
        gap: 24,
    },
    title: {
        fontSize: 48,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
    },
    subtitle: {
        fontSize: 16,
        opacity: 0.7,
    },
    mobileTitle: {
        fontSize: 40,
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
    },
    mobileSubtitle: {
        fontSize: 15,
        opacity: 0.6,
    },
});

