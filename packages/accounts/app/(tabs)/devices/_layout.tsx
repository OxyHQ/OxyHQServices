import { Stack } from 'expo-router';

export default function DevicesLayout() {
    return (
        <Stack>
            <Stack.Screen
                name="index"
                options={{
                    headerShown: false,
                }}
            />
            <Stack.Screen
                name="[deviceId]"
                options={{
                    presentation: 'modal',
                    title: 'Device Details',
                    headerShown: false,
                }}
            />
        </Stack>
    );
}

