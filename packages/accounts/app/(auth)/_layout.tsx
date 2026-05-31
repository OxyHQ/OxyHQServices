import { Stack } from 'expo-router';
import { AuthFlowProvider } from '@/contexts/auth-flow-context';
import { ErrorFallback } from '@/components/error-fallback';

/**
 * Auth Layout
 *
 * Single cross-platform layout for the authentication flow screens (welcome,
 * sign-in, create-identity, import-identity). The same stack registration
 * serves web and native; platform differences live inside the individual
 * screens, not in a layout shadow.
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
                <Stack.Screen name="sign-in" />
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

