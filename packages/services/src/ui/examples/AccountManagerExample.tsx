import React, { const AccountManager: React.FC<AccountManagerProps> = ({
    apiBaseUrl = 'http://localhost:3001',
    theme = 'light',
    autoPresent = true
}) => { } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import OxyProvider from '../components/OxyProvider';
import { OxyServices } from '../../core';

/**
 * Complete example of implementing the Account Management screens
 * This shows how to integrate all 5 account screens into your application
 */

interface AccountManagerProps {
    apiBaseUrl?: string;
    theme?: 'light' | 'dark';
    autoPresent?: boolean;
}

const AccountManager: React.FC<AccountManagerProps> = ({
    apiBaseUrl = 'http://localhost:3001',
    theme = 'light',
    autoPresent = true
}) => {
    const oxyProviderRef = useRef<any>(null);
    
    // Initialize OxyServices
    const oxyServices = new OxyServices({
        baseURL: apiBaseUrl
    });

    const handleOpenAccountCenter = () => {
        console.log('Navigate to Account Center - implement your navigation logic here');
        // In a real implementation, you would trigger the OxyProvider to open
        // This example shows the structure for integrating the screens
    };

    const handleOpenAccountOverview = () => {
        console.log('Navigate to Account Overview');
    };

    const handleOpenAccountSettings = () => {
        console.log('Navigate to Account Settings');
    };

    const handleOpenAccountSwitcher = () => {
        console.log('Navigate to Account Switcher');
    };

    const handleOpenSessionManagement = () => {
        console.log('Navigate to Session Management');
    };

    const handleOpenAccountSettingsWithTab = (tab: string) => {
        console.log(`Navigate to Account Settings with tab: ${tab}`);
    };

    const handleAuthenticated = (user: any) => {
        console.log('User authenticated:', user);
        Alert.alert('Welcome!', `Hello ${user.username}! You're now signed in.`);
    };

    const handleClosed = () => {
        console.log('Account management UI closed');
    };

    return (
        <View style={styles.container}>
            <View style={styles.header}>
                <Text style={styles.title}>Account Management Integration</Text>
                <Text style={styles.subtitle}>
                    Complete account management system with 5 interconnected screens
                </Text>
            </View>

            <View style={styles.buttonsContainer}>
                <Text style={styles.sectionTitle}>Main Screens</Text>
                
                <TouchableOpacity 
                    style={[styles.button, styles.primaryButton]} 
                    onPress={handleOpenAccountCenter}
                >
                    <Text style={styles.buttonText}>Open Account Center</Text>
                    <Text style={styles.buttonSubtext}>Main hub for all account features</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.button, styles.secondaryButton]} 
                    onPress={handleOpenAccountOverview}
                >
                    <Text style={[styles.buttonText, styles.secondaryText]}>Account Overview</Text>
                    <Text style={[styles.buttonSubtext, styles.secondaryText]}>Comprehensive account information</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.button, styles.secondaryButton]} 
                    onPress={handleOpenAccountSettings}
                >
                    <Text style={[styles.buttonText, styles.secondaryText]}>Account Settings</Text>
                    <Text style={[styles.buttonSubtext, styles.secondaryText]}>Edit profile and preferences</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.button, styles.secondaryButton]} 
                    onPress={handleOpenAccountSwitcher}
                >
                    <Text style={[styles.buttonText, styles.secondaryText]}>Account Switcher</Text>
                    <Text style={[styles.buttonSubtext, styles.secondaryText]}>Switch between multiple accounts</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                    style={[styles.button, styles.secondaryButton]} 
                    onPress={handleOpenSessionManagement}
                >
                    <Text style={[styles.buttonText, styles.secondaryText]}>Session Management</Text>
                    <Text style={[styles.buttonSubtext, styles.secondaryText]}>Manage active sessions</Text>
                </TouchableOpacity>

                <Text style={[styles.sectionTitle, { marginTop: 30 }]}>Settings with Specific Tabs</Text>
                
                <View style={styles.row}>
                    <TouchableOpacity 
                        style={[styles.button, styles.smallButton]} 
                        onPress={() => handleOpenAccountSettingsWithTab('profile')}
                    >
                        <Text style={[styles.buttonText, styles.smallText]}>Profile Tab</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={[styles.button, styles.smallButton]} 
                        onPress={() => handleOpenAccountSettingsWithTab('security')}
                    >
                        <Text style={[styles.buttonText, styles.smallText]}>Security Tab</Text>
                    </TouchableOpacity>
                </View>

                <View style={styles.row}>
                    <TouchableOpacity 
                        style={[styles.button, styles.smallButton]} 
                        onPress={() => handleOpenAccountSettingsWithTab('notifications')}
                    >
                        <Text style={[styles.buttonText, styles.smallText]}>Notifications</Text>
                    </TouchableOpacity>

                    <TouchableOpacity 
                        style={[styles.button, styles.smallButton]} 
                        onPress={() => handleOpenAccountSettingsWithTab('password')}
                    >
                        <Text style={[styles.buttonText, styles.smallText]}>Password</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {/* Implementation Note */}
            <View style={styles.implementationNote}>
                <Text style={styles.noteTitle}>Implementation Notes:</Text>
                <Text style={styles.noteText}>
                    • All screens are fully responsive with light/dark theme support{'\n'}
                    • Navigation history is maintained for proper back button behavior{'\n'}
                    • Screens adapt their snap points based on content{'\n'}
                    • Authentication state is managed automatically{'\n'}
                    • All interactions provide user feedback via toasts
                </Text>
            </View>

            {/* The OxyProvider handles all the account screens */}
            <OxyProvider
                oxyServices={oxyServices}
                initialScreen="AccountCenter"
                theme={theme}
                autoPresent={autoPresent}
                onAuthenticated={handleAuthenticated}
                onClose={handleClosed}
            />
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F8F9FA',
        padding: 20,
    },
    header: {
        marginBottom: 30,
        alignItems: 'center',
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#1a1a1a',
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        lineHeight: 22,
    },
    buttonsContainer: {
        flex: 1,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#333',
        marginBottom: 16,
        marginTop: 10,
    },
    button: {
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    primaryButton: {
        backgroundColor: '#0066CC',
    },
    secondaryButton: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#E1E5E9',
    },
    smallButton: {
        flex: 1,
        marginHorizontal: 4,
        padding: 12,
        backgroundColor: '#F0F3F7',
        borderWidth: 1,
        borderColor: '#D1D5DB',
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
        marginBottom: 4,
    },
    buttonSubtext: {
        fontSize: 14,
        color: '#B3D9FF',
    },
    secondaryText: {
        color: '#333',
    },
    smallText: {
        fontSize: 14,
        color: '#333',
        textAlign: 'center',
        marginBottom: 0,
    },
    row: {
        flexDirection: 'row',
        marginBottom: 12,
    },
    implementationNote: {
        backgroundColor: '#E8F4FD',
        borderRadius: 12,
        padding: 16,
        marginTop: 20,
        borderLeftWidth: 4,
        borderLeftColor: '#0066CC',
    },
    noteTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#0066CC',
        marginBottom: 8,
    },
    noteText: {
        fontSize: 14,
        color: '#555',
        lineHeight: 20,
    },
});

export default AccountManager;

// Usage in your main app:
/*
import AccountManager from './path/to/AccountManager';

function App() {
    return (
        <View style={{ flex: 1 }}>
            <AccountManager 
                apiBaseUrl="https://your-api-server.com"
                theme="light"
                autoPresent={false}
            />
        </View>
    );
}
*/
