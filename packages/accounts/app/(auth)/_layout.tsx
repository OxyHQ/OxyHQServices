import { Stack } from 'expo-router';
import { AuthFlowProvider } from '@/contexts/auth-flow-context';
import { ErrorFallback } from '@/components/error-fallback';

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

/**
 * Route-level error boundary for the auth flow. Captures render errors
 * inside `(auth)` so a crash during identity creation/import doesn't
 * leave the user stuck on a white screen.
 */
export function ErrorBoundary(props: { error: Error; retry: () => void }) {
    return <ErrorFallback {...props} />;
}

