import { Stack } from 'expo-router';

/**
 * Auth Layout
 * 
 * Layout for authentication flow screens (create identity, import identity, etc.)
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

