import type React from 'react';
import { useState, useEffect } from 'react';
import { Text, View, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import * as Font from 'expo-font';

/**
 * Get the Phudu font sources for both native and web environments 
 * This is specifically designed to work when distributed as an npm package
 */
const getPhuduFonts = () => {
    try {
        // For both development and when used as a package
        // Load all static font weights
        return {
            'Phudu-Light': require('../../assets/fonts/Phudu/Phudu-Light.ttf'),
            'Phudu-Regular': require('../../assets/fonts/Phudu/Phudu-Regular.ttf'),
            'Phudu-Medium': require('../../assets/fonts/Phudu/Phudu-Medium.ttf'),
            'Phudu-SemiBold': require('../../assets/fonts/Phudu/Phudu-SemiBold.ttf'),
            'Phudu-Bold': require('../../assets/fonts/Phudu/Phudu-Bold.ttf'),
            'Phudu-ExtraBold': require('../../assets/fonts/Phudu/Phudu-ExtraBold.ttf'),
            'Phudu-Black': require('../../assets/fonts/Phudu/Phudu-Black.ttf'),
        };
    } catch (error) {
        console.warn('Failed to load Phudu fonts:', error);
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
                // Get all the font weights
                const phuduFonts = getPhuduFonts();

                if (!phuduFonts) {
                    throw new Error('Phudu font files not found');
                }

                // Load all the static Phudu fonts with their respective weights
                await Font.loadAsync(phuduFonts);

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
        const phuduFonts = getPhuduFonts();

        if (!phuduFonts) {
            throw new Error('Phudu font files not found');
        }

        if (Platform.OS === 'web') {
            // For web platform, dynamically inject CSS to load the fonts
            if (typeof document !== 'undefined') {
                // Create a style element
                const style = document.createElement('style');

                // Define @font-face rules for each font weight
                const fontFaceRules = `
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFonts['Phudu-Light']}) format('truetype');
                        font-weight: 300;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFonts['Phudu-Regular']}) format('truetype');
                        font-weight: 400;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFonts['Phudu-Medium']}) format('truetype');
                        font-weight: 500;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFonts['Phudu-SemiBold']}) format('truetype');
                        font-weight: 600;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFonts['Phudu-Bold']}) format('truetype');
                        font-weight: 700;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFonts['Phudu-ExtraBold']}) format('truetype');
                        font-weight: 800;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Phudu';
                        src: url(${phuduFonts['Phudu-Black']}) format('truetype');
                        font-weight: 900;
                        font-style: normal;
                    }
                `;

                style.textContent = fontFaceRules;
                // Append to the document head
                document.head.appendChild(style);
                console.info('All Phudu web fonts have been dynamically loaded');
            }
        } else {
            // For native platforms, guidance for the package users
            console.info('Fonts should be linked in native projects to use Phudu fonts');

            // Attempt to load the fonts anyway (this works if the consumer has linked the assets)
            await Font.loadAsync(phuduFonts);
        }

        return true;
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('Error setting up fonts:', errorMessage);
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