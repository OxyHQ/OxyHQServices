import { Stack } from 'expo-router';
import { AuthFlowProvider } from './_authFlowContext';

/**
 * Auth Layout (Native Only)
 * 
 * Layout for authentication flow screens (create identity, import identity, etc.)
 * This layout is only available on native platforms (iOS/Android).
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
        <Stack.Screen name="create-identity" />
        <Stack.Screen name="import-identity" />
      </Stack>
    </AuthFlowProvider>
  );
}

