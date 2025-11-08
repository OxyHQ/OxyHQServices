import React from 'react';
import { Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Ionicons } from '@expo/vector-icons';

interface UserAvatarProps {
    size?: number;
}

export function UserAvatar({ size = 36 }: UserAvatarProps) {
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
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    justifyContent: 'center',
                    alignItems: 'center',
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: 1 },
                    shadowOpacity: 0.1,
                    shadowRadius: 2,
                    elevation: 2,
                    backgroundColor: isAuthenticated ? colors.tint : colorScheme === 'dark' ? '#2C2C2E' : '#F2F2F7'
                }
            ]}
            onPress={handlePress}
            activeOpacity={0.7}
        >
            {isAuthenticated && user ? (
                <Text style={[styles.initials, { color: '#FFFFFF', fontSize: size * 0.4 }]}>
                    {getInitials(user.username)}
                </Text>
            ) : (
                <Ionicons name="person" size={size * 0.5} color={colors.icon} />
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    initials: {
        fontWeight: '700',
    },
});
