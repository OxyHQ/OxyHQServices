import { Stack } from 'expo-router';

/**
 * Auth Layout (Base)
 * 
 * Base layout for authentication flow screens.
 * Platform-specific implementations are in _layout.native.tsx and _layout.web.tsx
 */
export default function AuthLayout() {
    return (
        <Stack
            screenOptions={{
                headerShown: false,
            }}
        >
            <Stack.Screen name="index" />
            <Stack.Screen name="create-identity" />
            <Stack.Screen name="import-identity" />
        </Stack>
    );
}

