import type React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet } from 'react-native';
import { OxyServices } from '../../core';

// Import types and route registry
import type { OxyRouterProps } from './types';
import { routes } from './routes';
import type { RouteName } from './routes';

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

    // Memoized navigation methods
    const navigate = useCallback((screen: RouteName, props: Record<string, any> = {}) => {
        if (__DEV__) console.log('OxyRouter: navigate called', screen, props);
        if (routes[screen]) {
            if (__DEV__) console.log('OxyRouter: screen found in routes');
            setCurrentScreen(screen);
            setScreenHistory(prev => [...prev, screen]);
            setScreenPropsMap(prev => ({ ...prev, [screen]: props }));
        } else {
            console.error(`OxyRouter: Screen "${screen}" not found in routes:`, Object.keys(routes));
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
        const CurrentScreen = (routes as any)[currentScreen]?.component;
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
