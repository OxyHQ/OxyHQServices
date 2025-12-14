import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Platform } from 'react-native';

/**
 * About Identity Screen (Web Fallback)
 * 
 * This screen is only available on native platforms (iOS/Android).
 * On web, this fallback redirects to home.
 */
export default function AboutIdentityScreen() {
    const router = useRouter();

    useEffect(() => {
        if (Platform.OS === 'web') {
            router.replace('/(tabs)');
        }
    }, [router]);

    return null;
}

