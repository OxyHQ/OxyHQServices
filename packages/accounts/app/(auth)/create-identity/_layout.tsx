import { Stack } from 'expo-router';

/**
 * Create Identity Flow Layout
 * 
 * Stack navigator for the create identity flow steps
 */
export default function CreateIdentityLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="username" />
      <Stack.Screen name="notifications" />
    </Stack>
  );
}

