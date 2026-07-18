import type React from 'react';
import { useState, useEffect } from 'react';
import * as Font from 'expo-font';

/**
 * Get the Inter font sources for native environments.
 * Loads all static Inter weights bundled with this package.
 */
const getInterFonts = () => {
    try {
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
 * FontLoader — loads custom fonts in the background while rendering children
 * immediately with system fonts as fallback until the custom fonts are ready.
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
                const interFonts = getInterFonts();

                if (!interFonts) {
                    throw new Error('Inter font files not found');
                }

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

    if (fontState === 'error' && __DEV__) {
        console.warn('Fonts failed to load. Using system fonts instead.');
    }

    return <>{children}</>;
};

/**
 * Setup fonts for applications consuming this package on native.
 */
export const setupFonts = async (): Promise<boolean> => {
    try {
        const interFonts = getInterFonts();

        if (!interFonts) {
            throw new Error('Inter font files not found');
        }

        await Font.loadAsync(interFonts);
        return true;
    } catch (error: unknown) {
        if (__DEV__) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn('Error setting up fonts:', errorMessage);
        }
        return false;
    }
};
