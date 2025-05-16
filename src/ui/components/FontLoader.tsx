import React, { useState, useEffect } from 'react';
import { Text, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import * as Font from 'expo-font';

/**
 * Get the font source for both native and web environments
 * This is specifically designed to work when distributed as an npm package
 */
const getPhuduFont = () => {
    try {
        // For both development and when used as a package
        // This is the most reliable approach for cross-platform compatibility
        return require('../../assets/fonts/Phudu-VariableFont_wght.ttf');
    } catch (error) {
        console.warn('Failed to load Phudu font:', error);
        return null;
    }
};

/**
 * FontLoader component that loads custom fonts before rendering children
 * This works in both the package development and when consumed as an npm package
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

                // Load the Phudu variable font with multiple weight variants
                await Font.loadAsync({
                    'Phudu-Variable': phuduFont,
                    'Phudu-Variable-Bold': phuduFont, // Same font file but registered with a bold name for native
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
 * Setup fonts for applications consuming this package
 * This should be called by applications using your package
 */
export const setupFonts = async () => {
    try {
        const phuduFont = getPhuduFont();

        if (!phuduFont) {
            throw new Error('Phudu font file not found');
        }

        if (Platform.OS === 'web') {
            // For web platform, dynamically inject CSS to load the font
            if (typeof document !== 'undefined') {
                // Create a style element
                const style = document.createElement('style');

                // Define the @font-face rule
                style.textContent = `
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFont}) format('truetype');
                        font-weight: 100 900; /* Variable font weight range */
                        font-style: normal;
                    }
                `;
                // Append to the document head
                document.head.appendChild(style);
                console.info('Web font Phudu has been dynamically loaded');
            }
        } else {
            // For native platforms, guidance for the package users
            console.info('Fonts should be linked in native projects to use Phudu-Variable font');

            // Attempt to load the font anyway (this works if the consumer has linked the assets)
            await Font.loadAsync({
                'Phudu-Variable': phuduFont,
                'Phudu-Variable-Bold': phuduFont,
            });
        }

        return true;
    } catch (error: any) {
        console.warn('Error setting up fonts:', error?.message || error);
        return false;
    }
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