import React from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface UserAvatarProps {
    name?: string;
    imageUrl?: string;
    size?: number;
}

export function UserAvatar({ name = 'User', imageUrl, size = 80 }: UserAvatarProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];

    const getInitials = (name: string) => {
        return name
            .split(' ')
            .map(n => n[0])
            .join('')
            .toUpperCase()
            .substring(0, 2);
    };

    return (
        <View
            style={[
                styles.container,
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: colors.tint,
                }
            ]}
        >
            {imageUrl ? (
                <Image
                    source={{ uri: imageUrl }}
                    style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]}
                />
            ) : (
                <Text style={[styles.initials, { fontSize: size / 2.5, color: '#FFFFFF' }]}>
                    {getInitials(name)}
                </Text>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    image: {
        resizeMode: 'cover',
    },
    initials: {
        fontWeight: '600',
    },
});
