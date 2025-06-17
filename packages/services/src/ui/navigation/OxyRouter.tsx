import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import AppInfoScreen from '../screens/AppInfoScreen';
import KarmaCenterScreen from '../screens/karma/KarmaCenterScreen';
import KarmaLeaderboardScreen from '../screens/karma/KarmaLeaderboardScreen';
import KarmaRulesScreen from '../screens/karma/KarmaRulesScreen';
import KarmaAboutScreen from '../screens/karma/KarmaAboutScreen';
import KarmaRewardsScreen from '../screens/karma/KarmaRewardsScreen';
import KarmaFAQScreen from '../screens/karma/KarmaFAQScreen';
import ProfileScreen from '../screens/ProfileScreen';

// Import types
import { OxyRouterProps, RouteConfig } from './types';

// Define route configuration with screen components and default snap points
const routes: Record<string, RouteConfig> = {
    SignIn: {
        component: SignInScreen,
        snapPoints: [],
    },
    SignUp: {
        component: SignUpScreen,
        snapPoints: [],
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
        snapPoints: [],
    },
    AppInfo: {
        component: AppInfoScreen,
        snapPoints: ['60%', '90%'],
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
};

// Add navigation debouncing and animation coordination
const NAVIGATION_DEBOUNCE_MS = 150;
const SNAP_POINT_ANIMATION_DELAY = 200;

const OxyRouter: React.FC<OxyRouterProps> = ({
    oxyServices,
    initialScreen,
    onClose,
    onAuthenticated,
    theme,
    adjustSnapPoints,
    navigationRef,
}) => {
    const [currentScreen, setCurrentScreen] = useState<string>(initialScreen);
    const [screenHistory, setScreenHistory] = useState<string[]>([initialScreen]);
    const [screenProps, setScreenProps] = useState<Record<string, any>>({});
    
    // Add navigation state management
    const [isNavigating, setIsNavigating] = useState(false);
    const navigationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastNavigationTimeRef = useRef<number>(0);

    // Update snap points when the screen changes - with proper timing coordination
    useEffect(() => {
        if (routes[currentScreen] && !isNavigating) {
            // Add a small delay to ensure navigation animation completes first
            const timer = setTimeout(() => {
                adjustSnapPoints(routes[currentScreen].snapPoints);
            }, SNAP_POINT_ANIMATION_DELAY);
            
            return () => clearTimeout(timer);
        }
    }, [currentScreen, adjustSnapPoints, isNavigating]);

    // Add state for managing screen transitions to prevent flicker
    const [pendingScreen, setPendingScreen] = useState<string | null>(null);
    const [pendingProps, setPendingProps] = useState<Record<string, any>>({});

    // Improved navigation with debouncing and state coordination
    const navigate = useCallback((screen: string, props: Record<string, any> = {}) => {
        const now = Date.now();
        
        // Debounce rapid navigation calls
        if (now - lastNavigationTimeRef.current < NAVIGATION_DEBOUNCE_MS) {
            console.log('[OxyRouter] Navigation debounced:', screen);
            return;
        }
        
        // Clear any pending navigation
        if (navigationTimeoutRef.current) {
            clearTimeout(navigationTimeoutRef.current);
        }
        
        if (routes[screen]) {
            console.log('[OxyRouter] Navigating to:', screen, 'with props:', props);
            setIsNavigating(true);
            lastNavigationTimeRef.current = now;
            
            // Use pending state to ensure atomic transitions
            setPendingScreen(screen);
            setPendingProps(props);
            
            // Update screen state atomically after a minimal delay
            navigationTimeoutRef.current = setTimeout(() => {
                // Batch all state updates together
                setCurrentScreen(screen);
                setScreenHistory(prev => [...prev, screen]);
                setScreenProps(props);
                setPendingScreen(null);
                setPendingProps({});
                
                // Clear navigation flag after state is updated
                setTimeout(() => {
                    setIsNavigating(false);
                }, 50); // Shorter delay for better responsiveness
            }, 50); // Minimal delay to ensure atomic update
        } else {
            console.error(`Screen "${screen}" not found`);
        }
    }, []);

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

    // Improved navigation event handling with better cleanup
    useEffect(() => {
        // Set up event listener for navigation events
        const handleNavigationEvent = (event: any) => {
            if (event && event.detail && !isNavigating) {
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

        // Use a more efficient navigation event system
        let intervalId: ReturnType<typeof setInterval> | null = null;
        
        if (typeof document !== 'undefined') {
            // Web - use custom event listener
            document.addEventListener('oxy:navigate', handleNavigationEvent);
        } else {
            // React Native - reduced polling frequency to prevent interference
            intervalId = setInterval(() => {
                if (!isNavigating) {
                    const globalNav = (globalThis as any).oxyNavigateEvent;
                    if (globalNav) {
                        console.log(`RN Navigation event received:`, globalNav);
                        if (globalNav.screen) {
                            navigate(globalNav.screen, globalNav.props || {});
                        }
                        // Clear the event after processing
                        (globalThis as any).oxyNavigateEvent = null;
                    }
                }
            }, 200); // Reduced from 100ms to 200ms to prevent conflicts
        }

        // Cleanup
        return () => {
            if (typeof document !== 'undefined') {
                document.removeEventListener('oxy:navigate', handleNavigationEvent);
            }
            if (intervalId) {
                clearInterval(intervalId);
            }
            if (navigationTimeoutRef.current) {
                clearTimeout(navigationTimeoutRef.current);
            }
        };
    }, [navigate, isNavigating]);

    const goBack = useCallback(() => {
        if (isNavigating) {
            console.log('[OxyRouter] Back navigation blocked - transition in progress');
            return;
        }
        
        if (screenHistory.length > 1) {
            setIsNavigating(true);
            const newHistory = [...screenHistory];
            newHistory.pop();
            const previousScreen = newHistory[newHistory.length - 1];
            
            // Use the same atomic update pattern as navigate
            setPendingScreen(previousScreen);
            setPendingProps({});
            
            setTimeout(() => {
                setCurrentScreen(previousScreen);
                setScreenHistory(newHistory);
                setScreenProps({});
                setPendingScreen(null);
                setPendingProps({});
                
                // Clear navigation flag after state is updated
                setTimeout(() => {
                    setIsNavigating(false);
                }, 50);
            }, 50);
        } else {
            // If no history, close the UI
            if (onClose) {
                onClose();
            }
        }
    }, [screenHistory, onClose, isNavigating]);

    // Render the current screen component with transition protection
    const renderScreen = () => {
        // During navigation transition, continue showing the current screen until the new one is ready
        // This prevents flicker by not rendering an intermediate state
        const screenToRender = pendingScreen && !isNavigating ? pendingScreen : currentScreen;
        const propsToUse = pendingScreen && !isNavigating ? pendingProps : screenProps;
        
        const CurrentScreen = routes[screenToRender]?.component;
        
        console.log('[OxyRouter] Rendering screen:', screenToRender);
        console.log('[OxyRouter] Available routes:', Object.keys(routes));
        console.log('[OxyRouter] Current screen component found:', !!CurrentScreen);
        console.log('[OxyRouter] Is navigating:', isNavigating, 'Pending screen:', pendingScreen);

        if (!CurrentScreen) {
            console.error(`Screen "${screenToRender}" not found`);
            return <View style={styles.errorContainer} />;
        }

        console.log('[OxyRouter] Rendering screen component for:', screenToRender);
        return (
            <CurrentScreen
                oxyServices={oxyServices}
                navigate={navigate}
                goBack={goBack}
                onClose={onClose}
                onAuthenticated={onAuthenticated}
                theme={theme}
                {...propsToUse}
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
    transitionContainer: {
        flex: 1,
        minHeight: 200, // Match container minHeight
        backgroundColor: 'transparent', // Transparent during transition to avoid flicker
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
