import type React from 'react';
import { useState, useEffect, useCallback, memo, useMemo, type ErrorInfo } from 'react';
import { View, StyleSheet } from 'react-native';
import ErrorBoundary from '../components/ErrorBoundary';

// Import types and route registry
import type { OxyRouterProps } from './types';
import { routes, routeNames } from './routes';
import type { RouteName } from './routes';

// Create a Set for O(1) route name lookups
const routeNameSet = new Set(routeNames);

// Pre-compute valid routes string for error messages (only computed once)
const VALID_ROUTES_STRING = routeNames.join(', ');

// Empty object constant to avoid creating new objects
const EMPTY_PROPS = Object.freeze({}) as Record<string, unknown>;

// Error container component (constant to avoid recreation)
const ErrorContainer = () => <View style={styles.errorContainer} />;

// Helper function to validate route and log errors
const validateRoute = (screen: string): screen is RouteName => {
    if (!routeNameSet.has(screen as RouteName)) {
        console.error('OxyRouter:', `Invalid route name: "${screen}". Valid routes are: ${VALID_ROUTES_STRING}`);
        return false;
    }

    const route = routes[screen as RouteName];
    if (!route) {
        console.error('OxyRouter:', `Route "${screen}" is registered but component is missing`);
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
    routerRef,
    containerWidth,
}) => {
    const [currentScreen, setCurrentScreen] = useState<RouteName>(initialScreen);
    const [screenHistory, setScreenHistory] = useState<RouteName[]>([initialScreen]);
    // Store props per screen for correct restoration on back
    const [screenPropsMap, setScreenPropsMap] = useState<Partial<Record<RouteName, Record<string, unknown>>>>(
        () => ({ [initialScreen]: {} })
    );

    // Memoize current route config
    const currentRouteConfig = useMemo(() => routes[currentScreen], [currentScreen]);

    // Update snap points when the screen changes
    useEffect(() => {
        if (currentRouteConfig && typeof adjustSnapPoints === 'function') {
            adjustSnapPoints(currentRouteConfig.snapPoints);
        }
    }, [currentRouteConfig, adjustSnapPoints]);

    // Memoized navigation methods with validation
    const navigate = useCallback((screen: RouteName, props: Record<string, unknown> = {}) => {
        if (__DEV__) {
            console.log('OxyRouter: navigate called', screen, props);
        }

        // Validate route before navigating
        if (!validateRoute(screen)) {
            return;
        }

        // All validations passed, proceed with navigation
        setCurrentScreen(screen);
        setScreenHistory(prev => [...prev, screen]);
        setScreenPropsMap(prev => ({ ...prev, [screen]: props }));
    }, []);

    const goBack = useCallback(() => {
        setScreenHistory(prev => {
            if (prev.length <= 1) {
                onClose?.();
                return prev;
            }
            const newHistory = prev.slice(0, -1);
            setCurrentScreen(newHistory[newHistory.length - 1]);
            return newHistory;
        });
    }, [onClose]);

    // Check if router can go back (has navigation history)
    const canGoBack = useCallback(() => {
        return screenHistory.length > 1;
    }, [screenHistory.length]);

    // Expose the navigate function to the parent component
    useEffect(() => {
        if (!navigationRef) return;

        navigationRef.current = navigate;
        if (__DEV__) console.log('OxyRouter: navigationRef set');

        return () => {
            navigationRef.current = null;
            if (__DEV__) console.log('OxyRouter: navigationRef cleared');
        };
    }, [navigate, navigationRef]);

    // Expose router controller (goBack, canGoBack) to parent component
    useEffect(() => {
        if (!routerRef) return;

        routerRef.current = {
            goBack,
            canGoBack,
        };

        return () => {
            routerRef.current = null;
        };
    }, [goBack, canGoBack, routerRef]);

    // Extract navigation detail processing logic
    const processNavigationDetail = useCallback((detail: { screen: RouteName; props?: Record<string, unknown> } | string) => {
        if (typeof detail === 'string') {
            if (validateRoute(detail)) {
                navigate(detail);
            }
        } else if (detail && typeof detail === 'object' && 'screen' in detail) {
            if (validateRoute(detail.screen)) {
                navigate(detail.screen, detail.props);
            }
        }
    }, [navigate]);

    // Memoize navigation event handler to prevent recreation on every render
    const handleNavigationEvent = useCallback(
        (event: CustomEvent<{ screen: RouteName; props?: Record<string, unknown> } | string>) => {
            processNavigationDetail(event.detail);
        },
        [processNavigationDetail]
    );

    // Handle navigation events from external sources (web environment only)
    // Note: React Native navigation should use navigationRef directly, not polling
    useEffect(() => {
        // Only set up event listener in web environments where document is available
        if (typeof document === 'undefined' || !document.addEventListener) {
            return;
        }

        document.addEventListener('oxy:navigate', handleNavigationEvent as EventListener);
        return () => {
            document.removeEventListener('oxy:navigate', handleNavigationEvent as EventListener);
        };
    }, [handleNavigationEvent]);

    // Memoize screen props to prevent unnecessary re-renders
    const screenProps = useMemo(() => screenPropsMap[currentScreen] || EMPTY_PROPS, [screenPropsMap, currentScreen]);

    // Memoize complete screen props object to avoid recreating on every render
    const screenPropsWithDefaults = useMemo(
        () => ({
            oxyServices,
            navigate,
            goBack,
            onClose,
            onAuthenticated,
            theme,
            containerWidth,
            ...screenProps,
        }),
        [oxyServices, navigate, goBack, onClose, onAuthenticated, theme, containerWidth, screenProps]
    );

    // Memoize error boundary handler to prevent recreation on every render
    const handleError = useCallback((error: Error, errorInfo: ErrorInfo) => {
        console.error(`Error in screen "${currentScreen}":`, error, errorInfo);
    }, [currentScreen]);

    // Memoize the rendered screen component
    const renderedScreen = useMemo(() => {
        const CurrentScreen = currentRouteConfig?.component;

        if (!CurrentScreen) {
            if (__DEV__) console.error(`Screen "${currentScreen}" not found`);
            return <ErrorContainer />;
        }

        return (
            <ErrorBoundary onError={handleError}>
                <CurrentScreen {...screenPropsWithDefaults} />
            </ErrorBoundary>
        );
    }, [currentRouteConfig, currentScreen, screenPropsWithDefaults, handleError]);

    return (
        <View style={styles.container}>
            {renderedScreen}
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
