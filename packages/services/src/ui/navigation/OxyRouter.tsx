import type React from 'react';
import { useState, useEffect, useCallback, memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { OxyServices } from '../../core';
import ErrorBoundary from '../components/ErrorBoundary';

// Import types and route registry
import type { OxyRouterProps } from './types';
import { routes, routeNames } from './routes';
import type { RouteName } from './routes';

// Helper function to validate route names at runtime
const isValidRouteName = (screen: string): screen is RouteName => {
    return routeNames.includes(screen as RouteName);
};

// Helper function for safe navigation with validation
const validateAndNavigate = (
    screen: string,
    props: Record<string, any>,
    setCurrentScreen: (screen: RouteName) => void,
    setScreenHistory: React.Dispatch<React.SetStateAction<RouteName[]>>,
    setScreenPropsMap: React.Dispatch<React.SetStateAction<Partial<Record<RouteName, any>>>>
): boolean => {
    if (!isValidRouteName(screen)) {
        const errorMsg = `Invalid route name: "${screen}". Valid routes are: ${routeNames.join(', ')}`;
        console.error('OxyRouter:', errorMsg);
        if (process.env.NODE_ENV !== 'production') {
            console.error('Navigation error:', errorMsg);
        }
        return false;
    }

    if (!routes[screen]) {
        const errorMsg = `Route "${screen}" is registered but component is missing`;
        console.error('OxyRouter:', errorMsg);
        if (process.env.NODE_ENV !== 'production') {
            console.error('Navigation error:', errorMsg);
        }
        return false;
    }

    return true;
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
    const [currentScreen, setCurrentScreen] = useState<RouteName>(initialScreen);
    const [screenHistory, setScreenHistory] = useState<RouteName[]>([initialScreen]);
    // Store props per screen for correct restoration on back
    const [screenPropsMap, setScreenPropsMap] = useState<Partial<Record<RouteName, any>>>({ [initialScreen]: {} });

    // Update snap points when the screen changes
    useEffect(() => {
        if ((routes as any)[currentScreen] && typeof adjustSnapPoints === 'function') {
            adjustSnapPoints((routes as any)[currentScreen].snapPoints);
        }
    }, [currentScreen, adjustSnapPoints]);

    // Memoized navigation methods with validation
    const navigate = useCallback((screen: RouteName, props: Record<string, any> = {}) => {
        if (__DEV__) console.log('OxyRouter: navigate called', screen, props);
        
        // Validate route before navigating
        if (!validateAndNavigate(screen, props, setCurrentScreen, setScreenHistory, setScreenPropsMap)) {
            return; // Early return if validation fails
        }

        // All validations passed, proceed with navigation
        setCurrentScreen(screen);
        setScreenHistory(prev => [...prev, screen]);
        setScreenPropsMap(prev => ({ ...prev, [screen]: props }));
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
            if (__DEV__) console.log('OxyRouter: navigationRef set');
        }
        return () => {
            if (navigationRef) {
                navigationRef.current = null;
                if (__DEV__) console.log('OxyRouter: navigationRef cleared');
            }
        };
    }, [navigate, navigationRef]);

    // Expose the navigate method to the parent component (OxyProvider)
    useEffect(() => {
        const handleNavigationEvent = (event: any) => {
            if (event && event.detail) {
                if (typeof event.detail === 'string') {
                    // Validate string route name before navigating
                    if (isValidRouteName(event.detail)) {
                        navigate(event.detail as RouteName);
                    } else {
                        console.error('OxyRouter: Invalid route name in event:', event.detail);
                    }
                } else if (typeof event.detail === 'object' && event.detail.screen) {
                    const { screen, props } = event.detail;
                    // Validate route name before navigating
                    if (isValidRouteName(screen)) {
                        navigate(screen as RouteName, props || {});
                    } else {
                        console.error('OxyRouter: Invalid route name in event:', screen);
                    }
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
                    // Validate route name before navigating
                    if (isValidRouteName(globalNav.screen)) {
                        navigate(globalNav.screen as RouteName, globalNav.props || {});
                        (globalThis as any).oxyNavigateEvent = null;
                    } else {
                        console.error('OxyRouter: Invalid route name in global event:', globalNav.screen);
                        (globalThis as any).oxyNavigateEvent = null; // Clear invalid event
                    }
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

    // Render the current screen component with error boundary
    const renderScreen = () => {
        const CurrentScreen = (routes as any)[currentScreen]?.component;
        if (!CurrentScreen) {
            if (process.env.NODE_ENV !== 'production') {
                console.error(`Screen "${currentScreen}" not found`);
            }
            return <View style={styles.errorContainer} />;
        }
        return (
            <ErrorBoundary
                onError={(error, errorInfo) => {
                    console.error(`Error in screen "${currentScreen}":`, error, errorInfo);
                }}
            >
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
            </ErrorBoundary>
        );
    };

    return (
        <View style={styles.container}>
            {renderScreen()}
        </View>
    );
};

// Memoize the router component to prevent unnecessary re-renders
const MemoizedOxyRouter = memo(OxyRouter);

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

// Export both the memoized version (default) and the original for testing
export { OxyRouter };
export default MemoizedOxyRouter;
