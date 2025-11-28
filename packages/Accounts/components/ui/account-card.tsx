import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface AccountCardProps {
    children: React.ReactNode;
}

export function AccountCard({ children }: AccountCardProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    return (
        <View style={[styles.accountCard, { backgroundColor: colors.card }]}>
            {children}
        </View>
    );
}

const styles = StyleSheet.create({
    accountCard: {
        borderRadius: 16,
        overflow: 'hidden',
        marginBottom: 16,
    },
});

