import React, { useRef, useState, useEffect } from 'react';
import { View, Button, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { BottomSheetModal } from '@gorhom/bottom-sheet';
// Note: This import would work in a real project where the package is installed via npm.
// For development/testing, you might need to use relative imports instead.
import { OxyServices, OxyProvider, User, useOxy } from '@oxyhq/services';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

/**
 * Example demonstrating how to use the OxyProvider component
 * with the bottomSheetRef prop for programmatic control
 * 
 * The OxyProvider component exposes methods on the bottomSheetRef:
 * - expand(): Opens the bottom sheet to its full height
 * - close(): Closes the bottom sheet
 * - snapToIndex(index): Positions the sheet at specific snap points
 * - snapToPosition(position): Positions the sheet at a specific position
 * - collapse(): Collapses the sheet to its smallest height
 * 
 * This example also demonstrates session management using OxyContext:
 * - The OxyProvider maintains authentication state
 * - Session data is persisted between app launches
 * - All children of OxyProvider can access auth data via useOxy() hook
 */
export default function App() {
    // Create a ref for the bottom sheet
    const bottomSheetRef = useRef<BottomSheetModal>(null);

    // Initialize OxyServices
    const oxyServices = new OxyServices({
        baseURL: 'https://api.example.com', // Replace with your API URL
    });

    // Create a SessionManager wrapper component
    const SessionManager = ({ children }: { children: React.ReactNode }) => {
        // State to track loading state
        const [isLoading, setIsLoading] = useState(true);

        // Use the OxyContext to access authentication state
        const { user, isAuthenticated, isLoading: authLoading } = useOxy();

        // Update UI after auth state is loaded
        useEffect(() => {
            if (!authLoading) {
                setIsLoading(false);
            }
        }, [authLoading]);

        if (isLoading) {
            return (
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color="#0066CC" />
                    <Text style={styles.loadingText}>Loading session...</Text>
                </View>
            );
        }

        return <>{children}</>;
    };

    // Enhanced component to show authenticated user info from OxyContext
    const UserInfo = () => {
        // Get all relevant user data and functions from OxyContext
        const { user, logout, isAuthenticated, error } = useOxy();

        const handleLogout = async () => {
            try {
                await logout();
                console.log('User logged out successfully via OxyContext');
            } catch (error) {
                console.error('Logout failed:', error);
            }
        };

        if (!user || !isAuthenticated) return null;

        return (
            <View style={styles.welcomeContainer}>
                <Text style={styles.welcomeText}>Welcome, {user.username}!</Text>
                <Text style={styles.sessionText}>User ID: {user.id}</Text>
                {user.email && <Text style={styles.sessionText}>Email: {user.email}</Text>}
                <Text style={styles.sessionInfoText}>Session maintained via OxyContext</Text>
                {error && <Text style={styles.errorText}>Error: {error}</Text>}
                <Button title="Logout" onPress={handleLogout} />
            </View>
        );
    };

    // Component to conditionally show the login button
    const LoginButton = ({ openSheet }: { openSheet: () => void }) => {
        const { user } = useOxy();
        if (user) return null;
        return <Button title="Sign In / Sign Up" onPress={openSheet} />;
    };

    // Methods to control the sheet
    const openSheet = () => {
        // The OxyProvider exposes an expand method on the bottomSheetRef
        if (bottomSheetRef.current) {
            bottomSheetRef.current.expand();
        }
    };

    const closeSheet = () => {
        // The OxyProvider exposes a close method on the bottomSheetRef
        if (bottomSheetRef.current) {
            bottomSheetRef.current.close();
        }
    };

    const snapToIndex = (index: number) => {
        // The OxyProvider exposes snapToIndex on the bottomSheetRef
        if (bottomSheetRef.current) {
            bottomSheetRef.current.snapToIndex(index);
        }
    };

    // Handle user authentication
    const handleAuthenticated = (authenticatedUser: User) => {
        console.log('User authenticated:', authenticatedUser);
        // The user will already be available in OxyContext, so we don't need to set it here
        // Close the sheet after successful authentication
        setTimeout(() => closeSheet(), 500);
    };

    // We no longer need this logout function as we're using the one from OxyContext
    // in the UserInfo component

    return (
        <GestureHandlerRootView style={styles.container}>
            <OxyProvider
                oxyServices={oxyServices}
                bottomSheetRef={bottomSheetRef}
                initialScreen="SignIn"
                autoPresent={false} // Don't auto-present, we'll control it with the button
                onClose={() => console.log('Sheet closed')}
                onAuthenticated={handleAuthenticated}
                onAuthStateChange={(user) => console.log('Auth state changed:', user?.username || 'logged out')}
                storageKeyPrefix="oxy_example" // Prefix for stored auth tokens
                theme="light"
            >
                <SessionManager>
                    <View style={styles.buttonContainer}>
                        {/* Show UserInfo component that uses OxyContext */}
                        <UserInfo />

                        {/* Only show login button if not authenticated */}
                        <LoginButton openSheet={openSheet} />

                        {/* Bottom sheet control buttons */}
                        <View style={styles.controlButtons}>
                            <Button title="Close Sheet" onPress={closeSheet} />
                            <Button title="Half Open" onPress={() => snapToIndex(0)} />
                            <Button title="Fully Open" onPress={() => snapToIndex(1)} />
                        </View>
                    </View>
                </SessionManager>
            </OxyProvider>
        </GestureHandlerRootView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    buttonContainer: {
        margin: 20,
        marginTop: 50,
        gap: 10,
    },
    controlButtons: {
        marginTop: 20,
        gap: 10,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    loadingText: {
        marginTop: 10,
        fontSize: 16,
        color: '#333',
    },
    welcomeContainer: {
        margin: 20,
        alignItems: 'center',
        padding: 15,
        backgroundColor: '#f0f0f0',
        borderRadius: 8,
    },
    welcomeText: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 10,
    },
    sessionText: {
        fontSize: 14,
        color: '#555',
        marginBottom: 5,
    },
    sessionInfoText: {
        fontSize: 12,
        color: '#0066CC',
        fontStyle: 'italic',
        marginTop: 10,
        marginBottom: 15,
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 14,
        marginBottom: 10,
    }
});
