// filepath: /home/nate/OxyServicesandApi/OxyHQServices/examples/BottomSheetExample.tsx
import React, { useState, useEffect } from 'react';
import { View, Button, StyleSheet, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Note: This import would work in a real project where the package is installed via npm.
// For development/testing, you might need to use relative imports instead.
import { OxyServices, OxyProvider, User, useOxy, OxySignInButton, OxyLogo } from '@oxyhq/services';

/**
 * Example demonstrating how to use the OxyProvider component
 * with the internal bottom sheet management
 * 
 * The OxyProvider component now manages the bottom sheet internally:
 * - No need for external ref
 * - No need to install @gorhom/bottom-sheet as a peer dependency
 * - Bottom sheet control is available via useOxy() context methods:
 *   - showBottomSheet(screen?): Opens the bottom sheet and optionally navigates to a screen
 *   - hideBottomSheet(): Closes the bottom sheet
 * 
 * This example also demonstrates session management using OxyContext:
 * - The OxyProvider maintains authentication state
 * - Session data is persisted between app launches
 * - All children of OxyProvider can access auth data via useOxy() hook
 */
export default function App() {
    // Initialize OxyServices
    const oxyServices = new OxyServices({
        baseURL: 'https://api.example.com', // Replace with your API URL
    });

    // Get user and showBottomSheet from context for use in the main App
    const { user, showBottomSheet } = useOxy();

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
                    <ActivityIndicator size="large" color="#d169e5" />
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
    const LoginButton = () => {
        const { user, showBottomSheet } = useOxy();

        if (user) return null;

        return <Button title="Sign In / Sign Up" onPress={() => showBottomSheet?.('SignIn')} />;
    };

    // Component to conditionally show the Account Center button
    const AccountCenterButton = () => {
        const { user, showBottomSheet } = useOxy();

        if (!user) return null;

        return (
            <TouchableOpacity
                style={styles.accountCenterButton}
                onPress={() => showBottomSheet?.('AccountCenter')}
            >
                <View style={styles.buttonContent}>
                    <OxyLogo
                        width={20}
                        height={20}
                        fillColor="white"
                        secondaryFillColor="rgba(255, 255, 255, 0.8)"
                    />
                    <Text style={styles.accountCenterButtonText}>Manage Account</Text>
                </View>
            </TouchableOpacity>
        );
    };

    // Handle user authentication - no hooks here
    const handleAuthenticated = (authenticatedUser: User) => {
        console.log('User authenticated:', authenticatedUser);
        // We'll just log the authentication event here
        // The bottom sheet will be closed by the OxyProvider internally
    };

    return (
        <GestureHandlerRootView style={styles.container}>
            <OxyProvider
                oxyServices={oxyServices}
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
                        <LoginButton />

                        {/* Use the new OxySignInButton component */}
                        <View style={styles.buttonExamples}>
                            <Text style={styles.sectionTitle}>OxySignInButton Examples:</Text>

                            {/* Default style */}
                            <OxySignInButton />

                            {/* Outlined variant */}
                            <OxySignInButton
                                variant="outline"
                                style={{ marginTop: 10 }}
                            />

                            {/* Contained variant */}
                            <OxySignInButton
                                variant="contained"
                                style={{ marginTop: 10 }}
                                text="Continue with Oxy"
                            />

                            {/* Custom handler example */}
                            <OxySignInButton
                                style={{ marginTop: 10 }}
                                text="Custom Handler"
                                onPress={() => {
                                    console.log('Custom authentication flow');
                                    // We'll use the OxySignInButton's internal handling
                                    // which already uses the context properly
                                }}
                            />

                            {/* Disabled button example */}
                            <OxySignInButton
                                variant="contained"
                                style={{ marginTop: 10 }}
                                text="Disabled Button"
                                disabled={true}
                            />
                        </View>

                        {/* Only show Account Center button if authenticated */}
                        <AccountCenterButton />

                        {/* Bottom sheet control buttons */}
                        <ButtonControls />
                    </View>
                </SessionManager>
            </OxyProvider>
        </GestureHandlerRootView>
    );
}

// Component for bottom sheet control buttons 
// This is needed to keep the hooks at the component level
const ButtonControls = () => {
    const { showBottomSheet, hideBottomSheet, user } = useOxy();

    return (
        <View style={styles.controlButtons}>
            <Button
                title="Close Sheet"
                onPress={() => hideBottomSheet?.()}
            />
            <Button
                title="Open Account Center"
                onPress={() => showBottomSheet?.('AccountCenter')}
                color="#d169e5"
            />
            {/* Button to open ProfileScreen for the current user */}
            {user && (
                <Button
                    title="View My Profile"
                    onPress={() => showBottomSheet?.({ screen: 'Profile', props: { userId: user.id, username: user.username } })}
                    color="#d169e5"
                />
            )}
        </View>
    );
};

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
    buttonExamples: {
        marginTop: 20,
        padding: 15,
        backgroundColor: '#f9f9f9',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#eaeaea',
    },
    sectionTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        marginBottom: 15,
        color: '#333',
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
        color: '#d169e5',
        fontStyle: 'italic',
        marginTop: 10,
        marginBottom: 15,
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 14,
        marginBottom: 10,
    },
    accountCenterButton: {
        backgroundColor: '#d169e5',
        padding: 14,
        borderRadius: 35,
        alignItems: 'center',
        marginTop: 10,
    },
    buttonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    accountCenterButtonText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
        marginLeft: 12,
    }
});
