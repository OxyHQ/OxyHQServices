import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import OxyProvider from '../components/OxyProvider';
import { OxyServices } from '../../core';

/**
 * Demo component showcasing the complete account management UI flow
 * This demonstrates how all the account screens work together
 */
const AccountManagementDemo: React.FC = () => {
    const oxyServices = new OxyServices({
        baseURL: 'https://api.oxy.so'
    });

    return (
        <View style={styles.container}>
            <ScrollView style={styles.content}>
                <Text style={styles.title}>Account Management System Demo</Text>
                <Text style={styles.description}>
                    Complete account management flow with 5 interconnected screens:
                </Text>

                <View style={styles.screensList}>
                    <ScreenCard
                        title="AccountCenterScreen"
                        description="Main account hub and entry point"
                        features={[
                            'User profile display',
                            'Quick access to all account features',
                            'Multi-account switching',
                            'Session management access'
                        ]}
                        navigatesTo={['AccountOverview', 'AccountSwitcher', 'AccountSettings', 'SessionManagement']}
                    />

                    <ScreenCard
                        title="AccountOverviewScreen"
                        description="Comprehensive account information and management"
                        features={[
                            'Detailed profile information',
                            'Account settings shortcuts',
                            'Subscription management',
                            'Privacy and security overview'
                        ]}
                        navigatesTo={['AccountSettings', 'SessionManagement']}
                    />

                    <ScreenCard
                        title="AccountSettingsScreen"
                        description="Complete account configuration and preferences"
                        features={[
                            'Profile editing (username, email, name)',
                            'Password management',
                            'Security settings',
                            'Notification preferences',
                            'Tabbed interface for organization'
                        ]}
                        navigatesTo={['Previous screen via goBack()']}
                    />

                    <ScreenCard
                        title="AccountSwitcherScreen"
                        description="Multi-account management and switching"
                        features={[
                            'View all saved accounts',
                            'Switch between accounts',
                            'Remove unwanted accounts',
                            'Device session management',
                            'Add new accounts'
                        ]}
                        navigatesTo={['SignIn', 'Account switching']}
                    />

                    <ScreenCard
                        title="SessionManagementScreen"
                        description="Active session management across devices"
                        features={[
                            'View all active sessions',
                            'Device information display',
                            'Logout specific sessions',
                            'Logout all sessions',
                            'Session security monitoring'
                        ]}
                        navigatesTo={['Session logout actions']}
                    />
                </View>

                <View style={styles.navigationFlow}>
                    <Text style={styles.sectionTitle}>Navigation Flow</Text>
                    <Text style={styles.flowDescription}>
                        The screens are designed with intuitive navigation patterns:
                    </Text>
                    
                    <View style={styles.flowItem}>
                        <Text style={styles.flowStep}>1. Entry Point</Text>
                        <Text style={styles.flowText}>Users typically start at AccountCenterScreen</Text>
                    </View>
                    
                    <View style={styles.flowItem}>
                        <Text style={styles.flowStep}>2. Explore</Text>
                        <Text style={styles.flowText}>Navigate to specific screens based on needs</Text>
                    </View>
                    
                    <View style={styles.flowItem}>
                        <Text style={styles.flowStep}>3. Manage</Text>
                        <Text style={styles.flowText}>Perform account actions in specialized screens</Text>
                    </View>
                    
                    <View style={styles.flowItem}>
                        <Text style={styles.flowStep}>4. Return</Text>
                        <Text style={styles.flowText}>Navigate back or to related screens seamlessly</Text>
                    </View>
                </View>

                <View style={styles.demoSection}>
                    <Text style={styles.sectionTitle}>Try the Demo</Text>
                    <TouchableOpacity style={styles.demoButton}>
                        <Text style={styles.demoButtonText}>
                            Launch Account Center
                        </Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>

            {/* The actual OxyProvider would be used here in a real implementation */}
            <OxyProvider
                oxyServices={oxyServices}
                initialScreen="AccountCenter"
                theme="light"
                autoPresent={false}
            />
        </View>
    );
};

const ScreenCard: React.FC<{
    title: string;
    description: string;
    features: string[];
    navigatesTo: string[];
}> = ({ title, description, features, navigatesTo }) => (
    <View style={styles.screenCard}>
        <Text style={styles.screenTitle}>{title}</Text>
        <Text style={styles.screenDescription}>{description}</Text>
        
        <Text style={styles.featuresTitle}>Features:</Text>
        {features.map((feature, index) => (
            <Text key={index} style={styles.feature}>• {feature}</Text>
        ))}
        
        <Text style={styles.navigationTitle}>Navigates to:</Text>
        {navigatesTo.map((nav, index) => (
            <Text key={index} style={styles.navigationItem}>→ {nav}</Text>
        ))}
    </View>
);

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    content: {
        flex: 1,
        padding: 20,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 10,
        textAlign: 'center',
    },
    description: {
        fontSize: 16,
        color: '#666',
        marginBottom: 20,
        textAlign: 'center',
        lineHeight: 22,
    },
    screensList: {
        marginBottom: 30,
    },
    screenCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 20,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    screenTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#0066CC',
        marginBottom: 8,
    },
    screenDescription: {
        fontSize: 14,
        color: '#666',
        marginBottom: 12,
        lineHeight: 20,
    },
    featuresTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginBottom: 8,
    },
    feature: {
        fontSize: 14,
        color: '#555',
        marginBottom: 4,
        marginLeft: 10,
    },
    navigationTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
        marginTop: 12,
        marginBottom: 8,
    },
    navigationItem: {
        fontSize: 14,
        color: '#0066CC',
        marginBottom: 4,
        marginLeft: 10,
    },
    navigationFlow: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 20,
        marginBottom: 30,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    sectionTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: '#333',
        marginBottom: 12,
    },
    flowDescription: {
        fontSize: 14,
        color: '#666',
        marginBottom: 16,
        lineHeight: 20,
    },
    flowItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    flowStep: {
        fontSize: 14,
        fontWeight: 'bold',
        color: '#0066CC',
        minWidth: 80,
    },
    flowText: {
        fontSize: 14,
        color: '#555',
        flex: 1,
        lineHeight: 20,
    },
    demoSection: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        padding: 20,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    demoButton: {
        backgroundColor: '#0066CC',
        borderRadius: 25,
        paddingHorizontal: 30,
        paddingVertical: 12,
        marginTop: 10,
    },
    demoButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
});

export default AccountManagementDemo;
