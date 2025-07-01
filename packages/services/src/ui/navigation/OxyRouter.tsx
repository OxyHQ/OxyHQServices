import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, Text } from 'react-native';
import oxyServices from '../../services/oxySingleton';

// Import screens
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import AccountCenterScreen from '../screens/AccountCenterScreen';
import AccountSwitcherScreen from '../screens/AccountSwitcherScreen';
import SessionManagementScreen from '../screens/SessionManagementScreen';
import AccountOverviewScreen from '../screens/AccountOverviewScreen';
import AccountSettingsScreen from '../screens/AccountSettingsScreen';
import AppSettingsScreen from '../screens/AppSettingsScreen';
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
    AppSettings: {
        component: AppSettingsScreen,
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

    // Navigation methods - memoized to prevent recreation on every render
    const navigate = useCallback((screen: string, props: Record<string, any> = {}) => {
        console.log('[OxyRouter] navigate called with screen:', screen, 'props:', props);
        console.log('[OxyRouter] Available routes:', Object.keys(routes));
        console.log('[OxyRouter] Route exists:', !!routes[screen]);

        if (routes[screen]) {
            console.log('[OxyRouter] Setting current screen to:', screen);
            setCurrentScreen(screen);
            setScreenHistory(prev => [...prev, screen]);
            setScreenProps(props);
        } else {
            console.error(`Screen "${screen}" not found`);
        }
    }, []); // Empty dependency array since this function only depends on stable state setters

    // Expose the navigate function to the parent component
    useEffect(() => {
        console.log('[OxyRouter] Setting up navigationRef.current with navigate function');
        if (navigationRef) {
            navigationRef.current = navigate;
            console.log('[OxyRouter] navigationRef.current set successfully');
        }

        return () => {
            console.log('[OxyRouter] Cleaning up navigationRef.current');
            if (navigationRef) {
                navigationRef.current = null;
            }
        };
    }, [navigate, navigationRef]);

    // Expose the navigate method globally so other contexts can trigger navigation without the ref
    useEffect(() => {
        const handleNavigationEvent = (event: any) => {
            const detail = event?.detail;
            if (!detail) return;

            if (typeof detail === 'string') {
                navigate(detail);
            } else if (typeof detail === 'object' && detail.screen) {
                navigate(detail.screen, detail.props || {});
            }
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('oxy:navigate', handleNavigationEvent);
            return () => document.removeEventListener('oxy:navigate', handleNavigationEvent);
        }
    }, [navigate]);

    // Go back helper
    const goBack = useCallback(() => {
        if (screenHistory.length > 1) {
            setScreenHistory(prev => {
                const newHistory = [...prev];
                newHistory.pop();
                const previousScreen = newHistory[newHistory.length - 1];
                setCurrentScreen(previousScreen);
                return newHistory;
            });
        } else {
            onClose?.();
        }
    }, [screenHistory, onClose]);

    // Render currently active screen
    const CurrentScreen = routes[currentScreen]?.component;

    if (!CurrentScreen) {
        return (
            <View style={styles.errorContainer}>
                <Text style={{ color: 'white', fontSize: 16 }}>Screen "{currentScreen}" not found</Text>
            </View>
        );
    }

    return (
        <View style={styles.container}>
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
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        minHeight: 200,
        backgroundColor: 'transparent',
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 100,
        backgroundColor: 'red',
    },
});

export default OxyRouter;
