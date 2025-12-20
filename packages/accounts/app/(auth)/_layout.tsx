import { Stack } from 'expo-router';
import { AuthFlowProvider } from '@/contexts/auth-flow-context';

/**
 * Auth Layout (Base)
 * 
 * Base layout for authentication flow screens.
 * Platform-specific implementations are in _layout.native.tsx and _layout.web.tsx
 */
export default function AuthLayout() {
    return (
        <AuthFlowProvider>
            <Stack
                screenOptions={{
                    headerShown: false,
                }}
            >
                <Stack.Screen name="index" />
                <Stack.Screen name="welcome" />
                <Stack.Screen name="create-identity" />
                <Stack.Screen name="import-identity" />
            </Stack>
        </AuthFlowProvider>
    );
}

