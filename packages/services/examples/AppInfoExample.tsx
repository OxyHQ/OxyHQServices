/**
 * AppInfoScreen Example
 * 
 * This example demonstrates how to use the AppInfoScreen component
 * to display comprehensive application information including package details,
 * system information, user data, and diagnostic tools.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import AppInfoScreen from '../src/ui/screens/AppInfoScreen';
import { OxyServices } from '../src/core';

// Mock OxyServices instance for example
const mockOxyServices = new OxyServices({ baseURL: 'http://localhost:3001' });

const AppInfoExample: React.FC = () => {
    const handleNavigate = (route: string, params?: any) => {
        console.log(`Navigate to: ${route}`, params);
        // In a real app, this would use your navigation system
        // For example: navigation.navigate(route, params);
    };

    const handleGoBack = () => {
        console.log('Going back');
        // In a real app, this would go back in navigation
        // For example: navigation.goBack();
    };

    const handleClose = () => {
        console.log('Closing App Info screen');
        // In a real app, this would close the modal/screen
        // For example: navigation.goBack();
    };

    return (
        <View style={styles.container}>
            <AppInfoScreen
                oxyServices={mockOxyServices}
                theme="light" // or "dark"
                navigate={handleNavigate}
                goBack={handleGoBack}
                onClose={handleClose}
            />
        </View>
    );
};

// Example with dark theme
const AppInfoDarkExample: React.FC = () => {
    return (
        <View style={styles.container}>
            <AppInfoScreen
                oxyServices={mockOxyServices}
                theme="dark"
                navigate={(route) => console.log(`Dark theme navigate: ${route}`)}
                goBack={() => console.log('Dark theme go back')}
                onClose={() => console.log('Closing dark theme app info')}
            />
        </View>
    );
};

// Example integration with React Navigation
const AppInfoWithNavigation: React.FC<{ navigation: any; oxyServices: OxyServices }> = ({ 
    navigation, 
    oxyServices 
}) => {
    return (
        <AppInfoScreen
            oxyServices={oxyServices}
            theme="light"
            navigate={(route, params) => navigation.navigate(route, params)}
            goBack={() => navigation.goBack()}
            onClose={() => navigation.goBack()}
        />
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f5f5f5',
    },
});

export default AppInfoExample;
export { AppInfoDarkExample, AppInfoWithNavigation };

/**
 * Key Features Demonstrated:
 * 
 * 1. Package Information Display
 *    - Automatically loads current version from package.json
 *    - Shows package name, description, and entry points
 * 
 * 2. System Information
 *    - Platform detection (iOS, Android, Web)
 *    - Screen dimensions and environment details
 * 
 * 3. User Information
 *    - Authentication status and user details
 *    - Multi-user account information
 * 
 * 4. Interactive Features
 *    - Copy individual fields to clipboard
 *    - Generate full JSON report
 *    - System check functionality
 * 
 * 5. Theme Support
 *    - Light and dark theme modes
 *    - Automatic color adaptation
 * 
 * 6. Navigation Integration
 *    - Works with any navigation system
 *    - Customizable close and navigate handlers
 * 
 * Usage Scenarios:
 * - Debugging and diagnostics
 * - User support and troubleshooting
 * - Application transparency
 * - Development information
 * - System health checks
 */
