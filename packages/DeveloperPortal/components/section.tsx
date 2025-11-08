import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from './themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface SectionProps {
    title?: string;
    children: React.ReactNode;
    isFirst?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function Section({ title, children, isFirst = false, style }: SectionProps) {
    const colorScheme = useColorScheme() ?? 'light';

    return (
        <View style={[styles.section, isFirst && styles.firstSection, style]}>
            {title && (
                <ThemedText style={[styles.sectionTitle]}>
                    {title}
                </ThemedText>
            )}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginBottom: 10,
    },
    firstSection: {
        marginTop: 8,
    },
    sectionTitle: {
        fontSize: 13,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 8,
        marginLeft: 16,
        opacity: 0.6,
    },
});
