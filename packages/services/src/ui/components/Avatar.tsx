import type React from 'react';
import { memo, useMemo } from 'react';
import { View, Text, Image, StyleSheet, type StyleProp, type ViewStyle, type ImageStyle, type TextStyle, ActivityIndicator, Platform } from 'react-native';
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
     * Full name to derive the initials from
     * For single word: takes first letter
     * For multiple words: takes first letter of first and last word (e.g., "John Doe" -> "JD")
     * For usernames starting with @: takes first two letters after @
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
 * Extracts initials from a name string
 * - Single word: first letter (e.g., "John" -> "J")
 * - Multiple words: first letter of first and last word (e.g., "John Doe" -> "JD")
 * - Username starting with @: first two letters after @ (e.g., "@johndoe" -> "JO")
 */
const getInitials = (nameStr: string): string => {
    if (!nameStr?.trim()) return '';

    const trimmed = nameStr.trim();
    const parts = trimmed.split(/\s+/).filter(part => part.length > 0);

    if (parts.length === 0) return '';

    if (parts.length === 1) {
        const firstPart = parts[0];
        // Handle username format (@username)
        if (firstPart.length >= 2 && firstPart.startsWith('@')) {
            return firstPart.substring(1, 3).toUpperCase();
        }
        return firstPart.charAt(0).toUpperCase();
    }

    // Multiple words: first letter of first and last word
    return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

/**
 * Generates a consistent color from a string (name)
 * Uses a simple hash function to create a deterministic color
 */
const generateColorFromString = (str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Generate a vibrant color with good contrast
    const hue = Math.abs(hash) % 360;
    // Use high saturation and medium lightness for vibrant, readable colors
    return `hsl(${hue}, 65%, 55%)`;
};

/**
 * Calculates font size based on avatar size for letter avatars
 * Uses a larger ratio for better visibility
 */
const calculateFontSize = (size: number): number => {
    // Use larger font size for letter avatars (50-55% of size)
    return size <= 40
        ? Math.floor(size * 0.5)
        : Math.floor(size * 0.45);
};

/**
 * Avatar component that displays either an image or text avatar
 * Falls back to displaying initials (1-2 letters) derived from the name if no image is provided
 * Supports flexible sizing via the size prop (default: 40px)
 * 
 * @example
 * <Avatar name="John Doe" size={100} theme="light" />
 * <Avatar uri="https://example.com/avatar.jpg" size={50} />
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
    const colors = useThemeColors(theme);

    const displayText = useMemo(
        () => text || (name ? getInitials(name) : ''),
        [text, name]
    );

    // Generate a color from the name for letter avatars (only when no backgroundColor is provided and no uri)
    const generatedBgColor = useMemo(
        () => {
            if (backgroundColor) return backgroundColor;
            if (uri) return colors.primary; // Use primary for image avatars as fallback
            // Generate color from name for letter avatars
            const nameForColor = name || text || 'User';
            return generateColorFromString(nameForColor);
        },
        [backgroundColor, uri, name, text, colors.primary]
    );

    // Memoize computed values to avoid recalculation on every render
    const bgColor = useMemo(
        () => generatedBgColor,
        [generatedBgColor]
    );

    const fontSize = useMemo(
        () => calculateFontSize(size),
        [size]
    );

    const containerStyle = useMemo(
        () => ({
            width: size,
            height: size,
            borderRadius: size / 2,
        }),
        [size]
    );

    const textStyleComputed = useMemo(
        () => [
            styles.text,
            {
                fontSize,
                fontFamily: fontFamilies.phuduBold,
                color: textColor,
                textAlign: 'center' as const,
                lineHeight: size, // Match line height to size for perfect vertical centering
                ...(Platform.OS === 'android' && { includeFontPadding: false }), // Remove extra padding for better centering (Android only)
            },
            textStyle,
        ],
        [fontSize, textColor, textStyle, size]
    );

    // Early return for loading state
    if (isLoading) {
        return (
            <View
                style={[
                    styles.container,
                    containerStyle,
                    { backgroundColor: colors.inputBackground },
                    style
                ]}
            >
                <ActivityIndicator
                    color={colors.primary}
                    size={size > 50 ? 'large' : 'small'}
                />
            </View>
        );
    }

    // Image avatar
    if (uri) {
        return (
            <View
                style={[
                    styles.container,
                    containerStyle,
                    { backgroundColor: bgColor },
                    style
                ]}
            >
                <Image
                    source={{ uri }}
                    style={[styles.image, containerStyle, imageStyle]}
                    resizeMode="cover"
                />
            </View>
        );
    }

    // Text avatar with initials
    return (
        <View
            style={[
                styles.container,
                containerStyle,
                { backgroundColor: bgColor },
                style
            ]}
        >
            <Text style={textStyleComputed}>
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
    image: {
        width: '100%',
        height: '100%',
    },
    text: {
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
    },
});

// Memoize component to prevent unnecessary re-renders when props haven't changed
export default memo(Avatar);
