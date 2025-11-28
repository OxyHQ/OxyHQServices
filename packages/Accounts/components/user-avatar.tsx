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

/**
 * Determines if a color is light or dark based on its luminance
 * Returns true if the color is light (should use dark text), false if dark (should use light text)
 */
const isLightColor = (color: string): boolean => {
    // Remove # if present
    const hex = color.replace('#', '');
    
    // Convert to RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    // Calculate relative luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    
    // Return true if light (luminance > 0.5), false if dark
    return luminance > 0.5;
};

/**
 * Gets appropriate text color based on background color
 * Returns white for dark backgrounds, dark for light backgrounds
 */
const getTextColorForBackground = (backgroundColor: string): string => {
    return isLightColor(backgroundColor) ? '#11181C' : '#FFFFFF';
};

const UserAvatarComponent = ({ name = 'User', imageUrl, size = 80 }: UserAvatarProps) => {
    const colorScheme = useColorScheme() ?? 'light';
    const colors = useMemo(() => Colors[colorScheme], [colorScheme]);

    const initials = useMemo(() => getInitials(name), [name]);

    // Use avatarBackground from theme, fallback to tint if not available
    const avatarBackground = useMemo(() => {
        return colors.avatarBackground || colors.tint;
    }, [colors.avatarBackground, colors.tint]);

    // Use avatarText from theme, or determine based on background brightness
    const avatarTextColor = useMemo(() => {
        if (colors.avatarText) {
            return colors.avatarText;
        }
        return getTextColorForBackground(avatarBackground);
    }, [colors.avatarText, avatarBackground]);

    const containerStyle = useMemo(() => [
        styles.container,
        {
            width: size,
            height: size,
            borderRadius: size / 2,
            ...(imageUrl ? {} : { backgroundColor: avatarBackground }),
        }
    ], [size, avatarBackground, imageUrl]);

    const imageStyle = useMemo(() => [
        styles.image,
        { width: size, height: size, borderRadius: size / 2 }
    ], [size]);

    const textStyle = useMemo(() => [
        styles.initials,
        { fontSize: size / 2.5, color: avatarTextColor }
    ], [size, avatarTextColor]);

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
