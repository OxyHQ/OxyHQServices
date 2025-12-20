import { Stack } from 'expo-router';
import { AuthFlowProvider } from '@/contexts/auth-flow-context';

/**
 * Auth Layout (Native Only)
 * 
 * Layout for authentication flow screens (create identity, import identity, etc.)
 * This layout is only available on native platforms (iOS/Android).
 * Note: Welcome screen is included for consistency with base layout.
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

