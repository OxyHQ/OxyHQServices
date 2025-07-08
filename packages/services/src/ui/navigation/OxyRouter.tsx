import React, { useState, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { OxyServices } from '../../core';

// Import screens
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import AccountCenterScreen from '../screens/AccountCenterScreen';
import AccountSwitcherScreen from '../screens/AccountSwitcherScreen';
import SessionManagementScreen from '../screens/SessionManagementScreen';
import AccountOverviewScreen from '../screens/AccountOverviewScreen';
import AccountSettingsScreen from '../screens/AccountSettingsScreen';
import PremiumSubscriptionScreen from '../screens/PremiumSubscriptionScreen';
import BillingManagementScreen from '../screens/BillingManagementScreen';
import AppInfoScreen from '../screens/AppInfoScreen';
import FeedbackScreen from '../screens/FeedbackScreen';
import KarmaCenterScreen from '../screens/karma/KarmaCenterScreen';
import KarmaLeaderboardScreen from '../screens/karma/KarmaLeaderboardScreen';
import KarmaRulesScreen from '../screens/karma/KarmaRulesScreen';
import KarmaAboutScreen from '../screens/karma/KarmaAboutScreen';
import KarmaRewardsScreen from '../screens/karma/KarmaRewardsScreen';
import KarmaFAQScreen from '../screens/karma/KarmaFAQScreen';
import ProfileScreen from '../screens/ProfileScreen';
import FileManagementScreen from '../screens/FileManagementScreen';
import RecoverAccountScreen from '../screens/RecoverAccountScreen';

// Import types
import { OxyRouterProps, RouteConfig } from './types';

// Define route configuration with screen components and default snap points
const routes: Record<string, RouteConfig> = {
    SignIn: {
        component: SignInScreen,
        snapPoints: ['10%', '80%'],
    },
    SignUp: {
        component: SignUpScreen,
        snapPoints: ['10%', '90%'],
    },
    RecoverAccount: {
        component: RecoverAccountScreen,
        snapPoints: ['10%', '80%'],
    },
    AccountCenter: {
        component: AccountCenterScreen,
        snapPoints: ['60%', '100%'],
    },
    AccountSwitcher: {
        component: AccountSwitcherScreen,
        snapPoints: ['70%', '100%'],
    },
    SessionManagement: {
        component: SessionManagementScreen,
        snapPoints: ['70%', '100%'],
    },
    AccountOverview: {
        component: AccountOverviewScreen,
        snapPoints: ['60%', '85%'],
    },
    AccountSettings: {
        component: AccountSettingsScreen,
        snapPoints: ['60%', '100%'],
    },
    PremiumSubscription: {
        component: PremiumSubscriptionScreen,
        snapPoints: ['70%', '100%'],
    },
    BillingManagement: {
        component: BillingManagementScreen,
        snapPoints: ['70%', '100%'],
    },
    AppInfo: {
        component: AppInfoScreen,
        snapPoints: ['60%', '90%'],
    },
    Feedback: {
        component: FeedbackScreen,
        snapPoints: ['70%', '100%'],
    },
    KarmaCenter: {
        component: KarmaCenterScreen,
        snapPoints: ['60%', '100%'],
    },
    KarmaLeaderboard: {
        component: KarmaLeaderboardScreen,
        snapPoints: ['60%', '100%'],
    },
    KarmaRules: {
        component: KarmaRulesScreen,
        snapPoints: ['60%', '90%'],
    },
    AboutKarma: {
        component: KarmaAboutScreen,
        snapPoints: ['60%', '90%'],
    },
    KarmaRewards: {
        component: KarmaRewardsScreen,
        snapPoints: ['60%', '90%'],
    },
    KarmaFAQ: {
        component: KarmaFAQScreen,
        snapPoints: ['60%', '90%'],
    },
    Profile: {
        component: ProfileScreen,
        snapPoints: ['60%', '90%'],
    },
    FileManagement: {
        component: FileManagementScreen,
        snapPoints: ['70%', '100%'],
    },
};

const OxyRouter: React.FC<OxyRouterProps> = ({
    oxyServices,
    initialScreen,
    onClose,
    onAuthenticated,
    theme,
    adjustSnapPoints,
    navigationRef,
    containerWidth,
}) => {
    const [currentScreen, setCurrentScreen] = useState<string>(initialScreen);
    const [screenHistory, setScreenHistory] = useState<string[]>([initialScreen]);
    const [screenProps, setScreenProps] = useState<Record<string, any>>({});

    // Update snap points when the screen changes
    useEffect(() => {
        if (routes[currentScreen]) {
            adjustSnapPoints(routes[currentScreen].snapPoints);
        }
    }, [currentScreen, adjustSnapPoints]);

    // Navigation methods
    const navigate = (screen: string, props: Record<string, any> = {}) => {
        if (routes[screen]) {
            setCurrentScreen(screen);
            setScreenHistory(prev => [...prev, screen]);
            setScreenProps(props);
        } else {
            console.error(`Screen "${screen}" not found`);
        }
    };

    // Expose the navigate function to the parent component
    useEffect(() => {
        if (navigationRef) {
            navigationRef.current = navigate;
        }

        return () => {
            if (navigationRef) {
                navigationRef.current = null;
            }
        };
    }, [navigate, navigationRef]);

    // Expose the navigate method to the parent component (OxyProvider)
    useEffect(() => {
        // Set up event listener for navigation events
        const handleNavigationEvent = (event: any) => {
            if (event && event.detail) {
                // Support both string and object detail
                if (typeof event.detail === 'string') {
                    const screenName = event.detail;
                    console.log(`Navigation event received for screen: ${screenName}`);
                    navigate(screenName);
                } else if (typeof event.detail === 'object' && event.detail.screen) {
                    const { screen, props } = event.detail;
                    console.log(`Navigation event received for screen: ${screen} with props`, props);
                    navigate(screen, props || {});
                }
            }
        };

        // For React Native - check for global navigation events
        let intervalId: any = null;

        if (typeof document !== 'undefined') {
            // Web - use custom event listener
            document.addEventListener('oxy:navigate', handleNavigationEvent);
        } else {
            // React Native - poll for global navigation events
            intervalId = setInterval(() => {
                const globalNav = (globalThis as any).oxyNavigateEvent;
                if (globalNav) {
                    console.log(`RN Navigation event received:`, globalNav);
                    if (globalNav.screen) {
                        navigate(globalNav.screen, globalNav.props || {});
                    }
                    // Clear the event after processing
                    (globalThis as any).oxyNavigateEvent = null;
                }
            }, 100); // Check every 100ms
        }

        // Cleanup
        return () => {
            if (typeof document !== 'undefined') {
                document.removeEventListener('oxy:navigate', handleNavigationEvent);
            }
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, []);

    const goBack = () => {
        if (screenHistory.length > 1) {
            const newHistory = [...screenHistory];
            newHistory.pop();
            const previousScreen = newHistory[newHistory.length - 1];
            setCurrentScreen(previousScreen);
            setScreenHistory(newHistory);
        } else {
            // If no history, close the UI
            if (onClose) {
                onClose();
            }
        }
    };

    // Render the current screen component
    const renderScreen = () => {
        const CurrentScreen = routes[currentScreen]?.component;

        console.log('[OxyRouter] Rendering screen:', currentScreen);
        console.log('[OxyRouter] Available routes:', Object.keys(routes));
        console.log('[OxyRouter] Current screen component found:', !!CurrentScreen);

        if (!CurrentScreen) {
            console.error(`Screen "${currentScreen}" not found`);
            return <View style={styles.errorContainer} />;
        }

        console.log('[OxyRouter] Rendering screen component for:', currentScreen);
        return (
            <CurrentScreen
                oxyServices={oxyServices}
                navigate={navigate}
                goBack={goBack}
                onClose={onClose}
                onAuthenticated={onAuthenticated}
                theme={theme}
                containerWidth={containerWidth}
                {...screenProps}
            />
        );
    };

    return (
        <View style={styles.container}>
            {renderScreen()}
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        minHeight: 200, // Ensure minimum height
        backgroundColor: 'transparent', // Make sure it's visible
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 100,
        backgroundColor: 'red', // Make errors visible
    },
});

export default OxyRouter;
