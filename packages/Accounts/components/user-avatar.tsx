import React, { useMemo, memo } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

interface UserAvatarProps {
    name?: string;
    imageUrl?: string;
    size?: number;
}

const getInitials = (name: string): string => {
    return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .substring(0, 2);
};

const UserAvatarComponent = ({ name = 'User', imageUrl, size = 80 }: UserAvatarProps) => {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = useMemo(() => Colors[colorScheme], [colorScheme]);

    const initials = useMemo(() => getInitials(name), [name]);

    const containerStyle = useMemo(() => [
        styles.container,
        {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: colors.tint,
        }
    ], [size, colors.tint]);

    const imageStyle = useMemo(() => [
        styles.image,
        { width: size, height: size, borderRadius: size / 2 }
    ], [size]);

    const textStyle = useMemo(() => [
        styles.initials,
        { fontSize: size / 2.5, color: '#FFFFFF' }
    ], [size]);

    return (
        <View style={containerStyle}>
            {imageUrl ? (
                <Image
                    source={{ uri: imageUrl }}
                    style={imageStyle}
                />
            ) : (
                <Text style={textStyle}>
                    {initials}
                </Text>
            )}
        </View>
    );
};

UserAvatarComponent.displayName = 'UserAvatar';

export const UserAvatar = memo(UserAvatarComponent);

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
