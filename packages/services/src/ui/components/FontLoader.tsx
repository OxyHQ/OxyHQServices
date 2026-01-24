import type React from 'react';
import { useState, useEffect } from 'react';
import { Platform } from 'react-native';
import * as Font from 'expo-font';

/**
 * Get the Inter font sources for both native and web environments
 * This is specifically designed to work when distributed as an npm package
 */
const getInterFonts = () => {
    try {
        // For both development and when used as a package
        // Load all static font weights
        return {
            'Inter-Light': require('../../assets/fonts/Inter/Inter_18pt-Light.ttf'),
            'Inter-Regular': require('../../assets/fonts/Inter/Inter_18pt-Regular.ttf'),
            'Inter-Medium': require('../../assets/fonts/Inter/Inter_18pt-Medium.ttf'),
            'Inter-SemiBold': require('../../assets/fonts/Inter/Inter_18pt-SemiBold.ttf'),
            'Inter-Bold': require('../../assets/fonts/Inter/Inter_18pt-Bold.ttf'),
            'Inter-ExtraBold': require('../../assets/fonts/Inter/Inter_18pt-ExtraBold.ttf'),
            'Inter-Black': require('../../assets/fonts/Inter/Inter_18pt-Black.ttf'),
        };
    } catch (error) {
        if (__DEV__) {
        console.warn('Failed to load Inter fonts:', error);
        }
        return null;
    }
};

/**
 * FontLoader component that loads custom fonts in the background while rendering children immediately
 * This works in both the package development and when consumed as an npm package
 * Children render immediately with system fonts as fallback until custom fonts are loaded
 */
export const FontLoader = ({
    children,
}: {
    children: React.ReactNode;
}) => {
    const [fontState, setFontState] = useState<'loading' | 'loaded' | 'error'>('loading');

    useEffect(() => {
        const loadFonts = async () => {
            try {
                // Get all the font weights
                const interFonts = getInterFonts();

                if (!interFonts) {
                    throw new Error('Inter font files not found');
                }

                // Load all the static Inter fonts with their respective weights
                await Font.loadAsync(interFonts);

                setFontState('loaded');
            } catch (error) {
                if (__DEV__) {
                console.error('Error loading fonts:', error);
                }
                setFontState('error');
            }
        };

        loadFonts();
    }, []);

    // Always render children immediately - fonts will load in background
    // If fonts aren't loaded yet, the app will use system fonts as fallback
    if (fontState === 'error' && __DEV__) {
        console.warn('Fonts failed to load. Using system fonts instead.');
    }

    // Render children immediately, even while fonts are loading
    // Fonts will apply when they're ready, otherwise system fonts are used
    return <>{children}</>;
};

/**
 * Setup fonts for applications consuming this package
 * This should be called by applications using your package
 */
export const setupFonts = async () => {
    try {
        const interFonts = getInterFonts();

        if (!interFonts) {
            throw new Error('Inter font files not found');
        }

        if (Platform.OS === 'web') {
            // For web platform, dynamically inject CSS to load the fonts
            if (typeof document !== 'undefined') {
                // Create a style element
                const style = document.createElement('style');

                // Define @font-face rules for each font weight
                const fontFaceRules = `
                    @font-face {
                        font-family: 'Inter';
                        src: url(${interFonts['Inter-Light']}) format('truetype');
                        font-weight: 300;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Inter';
                        src: url(${interFonts['Inter-Regular']}) format('truetype');
                        font-weight: 400;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Inter';
                        src: url(${interFonts['Inter-Medium']}) format('truetype');
                        font-weight: 500;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Inter';
                        src: url(${interFonts['Inter-SemiBold']}) format('truetype');
                        font-weight: 600;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Inter';
                        src: url(${interFonts['Inter-Bold']}) format('truetype');
                        font-weight: 700;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Inter';
                        src: url(${interFonts['Inter-ExtraBold']}) format('truetype');
                        font-weight: 800;
                        font-style: normal;
                    }
                    @font-face {
                        font-family: 'Inter';
                        src: url(${interFonts['Inter-Black']}) format('truetype');
                        font-weight: 900;
                        font-style: normal;
                    }
                `;

                style.textContent = fontFaceRules;
                document.head.appendChild(style);
                if (__DEV__) {
                console.info('All Inter web fonts have been dynamically loaded');
                }
            }
        } else {
            // Attempt to load the fonts anyway (this works if the consumer has linked the assets)
            await Font.loadAsync(interFonts);
        }

        return true;
    } catch (error: unknown) {
        if (__DEV__) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn('Error setting up fonts:', errorMessage);
        }
        return false;
    }
};