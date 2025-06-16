import React from 'react';
import { View, Text, Image, StyleSheet, StyleProp, ViewStyle, ImageStyle, TextStyle, ActivityIndicator, Platform } from 'react-native';
import { useThemeColors } from '../styles';
import { fontFamilies } from '../styles/fonts';

export interface AvatarProps {
    /**
     * URL of the avatar image
     */
    uri?: string;

    /**
     * Text to display when no image is available
     * Defaults to first letter of name if name is provided
     */
    text?: string;

    /**
     * Full name to derive the initials from (takes first letter)
     */
    name?: string;

    /**
     * Size of the avatar in pixels
     * @default 40
     */
    size?: number;

    /**
     * Theme to use for colors
     * @default 'light'
     */
    theme?: 'light' | 'dark';

    /**
     * Background color for text avatar
     * Defaults to theme primary color
     */
    backgroundColor?: string;

    /**
     * Text color for text avatar
     * @default '#FFFFFF'
     */
    textColor?: string;

    /**
     * Additional styles for the container
     */
    style?: StyleProp<ViewStyle>;

    /**
     * Additional styles for the image
     * Only used when uri is provided
     */
    imageStyle?: StyleProp<ImageStyle>;

    /**
     * Additional styles for the text
     */
    textStyle?: StyleProp<TextStyle>;

    /**
     * Is loading state
     * @default false
     */
    isLoading?: boolean;
}

/**
 * Avatar component that displays either an image or text avatar
 * Falls back to displaying the first letter of the name if no image is provided
 */
const Avatar: React.FC<AvatarProps> = ({
    uri,
    text,
    name,
    size = 40,
    theme = 'light',
    backgroundColor,
    textColor = '#FFFFFF',
    style,
    imageStyle,
    textStyle,
    isLoading = false,
}) => {
    // Get theme colors
    const colors = useThemeColors(theme);

    // Use the primary color from theme as default background if not specified
    const bgColor = backgroundColor || colors.primary;

    // Calculate font size based on avatar size
    const fontSize = Math.floor(size * 0.4);

    // Determine what text to display for fallback
    const displayText = text ||
        (name ? name.charAt(0).toUpperCase() : '');

    // Style for container based on size
    const containerStyle = {
        width: size,
        height: size,
        borderRadius: size / 2, // Make it circular
    };

    if (isLoading) {
        return (
            <View style={[styles.container, containerStyle, { backgroundColor: colors.inputBackground }, style]}>
                <ActivityIndicator color={colors.primary} size={size > 50 ? 'large' : 'small'} />
            </View>
        );
    }

    // If an image URL is provided, use Image component
    if (uri) {
        return (
            <Image
                source={{ uri: uri }}
                style={[styles.container, containerStyle, imageStyle]}
            />
        );
    }

    // Otherwise show text avatar
    return (
        <View style={[styles.container, containerStyle, { backgroundColor: bgColor }, style]}>
            <Text style={[
                styles.text,
                {
                    fontSize,
                    fontFamily: fontFamilies.phuduBold,
                },
                { color: textColor },
                textStyle
            ]}>
                {displayText}
            </Text>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
    },
    text: {
        // Font family is applied directly in the component to use the constants
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined, // Only apply fontWeight on web
    },
});

export default Avatar;
