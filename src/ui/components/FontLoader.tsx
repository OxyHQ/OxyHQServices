import React, { useState, useEffect } from 'react';
import { Text, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import * as Font from 'expo-font';

// Import font based on environment
// This approach handles both development and production builds
const getPhuduFont = () => {
    try {
        // Try to load from the standard path (development)
        return require('../../assets/fonts/Phudu-VariableFont_wght.ttf');
    } catch (e) {
        try {
            // Try to load from the lib path (production/npm package)
            return require('../assets/fonts/Phudu-VariableFont_wght.ttf');
        } catch (e2) {
            console.error('Failed to load Phudu font:', e2);
            return null;
        }
    }
};

/**
 * FontLoader component that loads custom fonts before rendering children
 * This is useful for apps that use Expo
 */
export const FontLoader = ({
    children,
    fallbackContent,
}: {
    children: React.ReactNode;
    fallbackContent?: React.ReactNode;
}) => {
    const [fontState, setFontState] = useState<'loading' | 'loaded' | 'error'>('loading');

    useEffect(() => {
        const loadFonts = async () => {
            try {
                // Get the font based on environment
                const phuduFont = getPhuduFont();

                if (!phuduFont) {
                    throw new Error('Phudu font file not found');
                }

                // Load the Phudu variable font
                await Font.loadAsync({
                    'Phudu-Variable': phuduFont,
                });
                setFontState('loaded');
            } catch (error) {
                console.error('Error loading fonts:', error);
                // Fallback to render without custom fonts
                setFontState('error');
            }
        };

        loadFonts();
    }, []);

    if (fontState === 'loading') {
        // Render a loading placeholder while fonts are loading
        if (fallbackContent) {
            return <>{fallbackContent}</>;
        }
        return (
            <View style={styles.loaderContainer}>
                <ActivityIndicator size="small" color="#d169e5" />
            </View>
        );
    }

    if (fontState === 'error') {
        console.warn('Fonts failed to load. Using system fonts instead.');
    }

    // Return children even on error - the app will use system fonts as fallback
    return <>{children}</>;
};

/**
 * Setup fonts for non-Expo React Native projects and web
 * This function needs to be called once at your app's entry point
 */
export const setupFonts = () => {
    // For React Native, the fonts need to be properly linked
    if (Platform.OS !== 'web') {
        // Link fonts for native platforms
        // For React Native without Expo, the fonts should be linked using:
        // 1. For iOS: Add the font file to Xcode project and add entry to Info.plist
        // 2. For Android: Place the font in android/app/src/main/assets/fonts/
        // Or use: npx react-native-asset link
        console.info('Fonts should be linked in native projects to use Phudu-Variable font');
        return true;
    }

    // For web platform, dynamically inject CSS to load the font
    if (typeof document !== 'undefined') {
        try {
            // Create a style element
            const style = document.createElement('style');

            // Try to get the font
            let fontPath: string;
            try {
                // Try to resolve the font path dynamically
                const fontModule = getPhuduFont();
                // In bundled apps, this may be a resolved URL
                fontPath = typeof fontModule === 'string' ? fontModule : '/assets/fonts/Phudu-VariableFont_wght.ttf';
            } catch (e) {
                // Fallback to conventional path
                fontPath = '/assets/fonts/Phudu-VariableFont_wght.ttf';
            }

            // Define the @font-face rule
            style.textContent = `
        @font-face {
          font-family: 'Phudu';
          src: url('${fontPath}') format('truetype');
          font-weight: 100 900; /* Variable font weight range */
          font-style: normal;
        }
      `;
            // Append to the document head
            document.head.appendChild(style);
            console.info('Web font Phudu has been dynamically loaded from: ' + fontPath);
        } catch (error) {
            console.error('Failed to load web font:', error);
        }
    }

    return true;
};

const styles = StyleSheet.create({
    loaderContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'transparent',
    },
});
