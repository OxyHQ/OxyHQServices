import React, { useState, useEffect, useCallback } from 'react';
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
import PaymentGatewayScreen from '../screens/PaymentGatewayScreen';

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
    EditProfile: {
        component: AccountSettingsScreen,
        snapPoints: ['60%', '100%'],
    },
    PremiumSubscription: {
        component: PremiumSubscriptionScreen,
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
    PaymentGateway: {
        component: PaymentGatewayScreen,
        snapPoints: ['60%', '90%'],
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
    // Store props per screen for correct restoration on back
    const [screenPropsMap, setScreenPropsMap] = useState<Record<string, any>>({ [initialScreen]: {} });

    // Update snap points when the screen changes
    useEffect(() => {
        if (routes[currentScreen] && typeof adjustSnapPoints === 'function') {
            adjustSnapPoints(routes[currentScreen].snapPoints);
        }
    }, [currentScreen, adjustSnapPoints]);

    // Memoized navigation methods
    const navigate = useCallback((screen: string, props: Record<string, any> = {}) => {
        if (routes[screen]) {
            setCurrentScreen(screen);
            setScreenHistory(prev => [...prev, screen]);
            setScreenPropsMap(prev => ({ ...prev, [screen]: props }));
        } else {
            if (process.env.NODE_ENV !== 'production') {
                console.error(`Screen "${screen}" not found`);
            }
        }
    }, []);

    const goBack = useCallback(() => {
        setScreenHistory(prev => {
            if (prev.length > 1) {
                const newHistory = [...prev];
                newHistory.pop();
                const previousScreen = newHistory[newHistory.length - 1];
                setCurrentScreen(previousScreen);
                return newHistory;
            } else {
                if (onClose) onClose();
                return prev;
            }
        });
    }, [onClose]);

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
        const handleNavigationEvent = (event: any) => {
            if (event && event.detail) {
                if (typeof event.detail === 'string') {
                    navigate(event.detail);
                } else if (typeof event.detail === 'object' && event.detail.screen) {
                    const { screen, props } = event.detail;
                    navigate(screen, props || {});
                }
            }
        };

        let intervalId: any = null;
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('oxy:navigate', handleNavigationEvent);
        } else {
            intervalId = setInterval(() => {
                const globalNav = (globalThis as any).oxyNavigateEvent;
                if (globalNav && globalNav.screen) {
                    navigate(globalNav.screen, globalNav.props || {});
                    (globalThis as any).oxyNavigateEvent = null;
                }
            }, 100);
        }
        return () => {
            if (typeof document !== 'undefined' && document.removeEventListener) {
                document.removeEventListener('oxy:navigate', handleNavigationEvent);
            }
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [navigate]);

    // Render the current screen component
    const renderScreen = () => {
        const CurrentScreen = routes[currentScreen]?.component;
        if (!CurrentScreen) {
            if (process.env.NODE_ENV !== 'production') {
                console.error(`Screen "${currentScreen}" not found`);
            }
            return <View style={styles.errorContainer} />;
        }
        return (
            <CurrentScreen
                oxyServices={oxyServices}
                navigate={navigate}
                goBack={goBack}
                onClose={onClose}
                onAuthenticated={onAuthenticated}
                theme={theme}
                containerWidth={containerWidth}
                {...(screenPropsMap[currentScreen] || {})}
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
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 100,
    },
});

export default OxyRouter;
