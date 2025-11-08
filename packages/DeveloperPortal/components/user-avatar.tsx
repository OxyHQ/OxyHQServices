import React from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';

export function UserAvatar() {
    const { user, isAuthenticated, showBottomSheet } = useOxy();
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const getInitials = (username: string) => {
        return username
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
    };

    const handlePress = () => {
        if (!isAuthenticated) {
            showBottomSheet?.('SignIn');
        } else {
            // Show account overview bottom sheet when authenticated
            showBottomSheet?.('AccountOverview');
        }
    };

    return (
        <TouchableOpacity
            style={[
                styles.container,
                {
                    backgroundColor: isAuthenticated ? colors.tint : colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7'
                }
            ]}
            onPress={handlePress}
            activeOpacity={0.7}
        >
            {isAuthenticated && user ? (
                <Text style={[styles.initials, { color: '#FFFFFF' }]}>
                    {getInitials(user.username)}
                </Text>
            ) : (
                <Ionicons name="person" size={18} color={colors.icon} />
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        width: 36,
        height: 36,
        borderRadius: 18,
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },
    initials: {
        fontSize: 14,
        fontWeight: '700',
    },
});
