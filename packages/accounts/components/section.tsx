import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { ThemedText } from './themed-text';

interface SectionProps {
    title?: string;
    children: React.ReactNode;
    isFirst?: boolean;
    style?: StyleProp<ViewStyle>;
}

export function Section({ title, children, isFirst = false, style }: SectionProps) {
    return (
        <View style={[styles.section, isFirst && styles.firstSection, style]}>
            {title && (
                <ThemedText style={styles.sectionTitle}>
                    {title}
                </ThemedText>
            )}
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginBottom: 24,
    },
    firstSection: {
        marginTop: 0,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 8,
    },
});
