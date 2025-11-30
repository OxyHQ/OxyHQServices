import type React from 'react';
import { useState, useEffect, useCallback, memo, useMemo, type ErrorInfo } from 'react';
import { View, StyleSheet } from 'react-native';
import ErrorBoundary from '../components/ErrorBoundary';
import { ThemeProvider } from '../context/ThemeContext';

// Import types and route registry
import type { OxyRouterProps } from './types';
import { routes } from './routes';
import type { RouteName } from './routes';

// Import utilities
import { validateRoute, EMPTY_PROPS } from './navigationUtils';

// Error container component (constant to avoid recreation)
const ErrorContainer = () => <View style={styles.errorContainer} />;

const OxyRouter: React.FC<OxyRouterProps> = ({
    oxyServices,
    initialScreen,
    onClose,
    onAuthenticated,
    theme,
    adjustSnapPoints,
    navigationRef,
    routerRef,
    stepControllerRef,
    containerWidth,
}) => {
    // ========================================================================
    // State Management
    // ========================================================================
    const [currentScreen, setCurrentScreen] = useState<RouteName>(initialScreen);
    const [screenHistory, setScreenHistory] = useState<RouteName[]>([initialScreen]);
    const [screenPropsMap, setScreenPropsMap] = useState<Partial<Record<RouteName, Record<string, unknown>>>>(
        () => ({ [initialScreen]: {} })
    );

    // ========================================================================
    // Computed Values
    // ========================================================================
    const currentRouteConfig = useMemo(() => routes[currentScreen], [currentScreen]);

    // ========================================================================
    // Navigation Methods
    // ========================================================================
    const navigate = useCallback((screen: RouteName, props: Record<string, unknown> = {}) => {
        if (__DEV__) {
            console.log('OxyRouter: navigate called', screen, props);
        }

        if (!validateRoute(screen)) {
            return;
        }

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

    const canGoBack = useCallback(() => {
        return screenHistory.length > 1;
    }, [screenHistory.length]);

    // ========================================================================
    // Ref Exposure
    // ========================================================================
    useEffect(() => {
        if (!navigationRef) return;
        navigationRef.current = navigate;
        if (__DEV__) console.log('OxyRouter: navigationRef set');
        return () => {
            navigationRef.current = null;
            if (__DEV__) console.log('OxyRouter: navigationRef cleared');
        };
    }, [navigate, navigationRef]);

    useEffect(() => {
        if (!routerRef) return;
        routerRef.current = { goBack, canGoBack };
        return () => {
            routerRef.current = null;
        };
    }, [goBack, canGoBack, routerRef]);

    // ========================================================================
    // External Navigation Events (Web only)
    // ========================================================================
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

    const handleNavigationEvent = useCallback(
        (event: CustomEvent<{ screen: RouteName; props?: Record<string, unknown> } | string>) => {
            processNavigationDetail(event.detail);
        },
        [processNavigationDetail]
    );

    useEffect(() => {
        if (typeof document === 'undefined' || !document.addEventListener) {
            return;
        }

        document.addEventListener('oxy:navigate', handleNavigationEvent as EventListener);
        return () => {
            document.removeEventListener('oxy:navigate', handleNavigationEvent as EventListener);
        };
    }, [handleNavigationEvent]);

    // ========================================================================
    // Snap Points Management
    // ========================================================================
    useEffect(() => {
        if (currentRouteConfig && typeof adjustSnapPoints === 'function') {
            adjustSnapPoints(currentRouteConfig.snapPoints);
        }
    }, [currentRouteConfig, adjustSnapPoints]);

    // ========================================================================
    // Screen Props & Rendering
    // ========================================================================
    const screenProps = useMemo(() => screenPropsMap[currentScreen] || EMPTY_PROPS, [screenPropsMap, currentScreen]);

    const screenPropsWithDefaults = useMemo(
        () => ({
            oxyServices,
            navigate,
            goBack,
            onClose,
            onAuthenticated,
            theme,
            containerWidth,
            stepControllerRef,
            ...screenProps,
        }),
        [oxyServices, navigate, goBack, onClose, onAuthenticated, theme, containerWidth, stepControllerRef, screenProps]
    );

    const handleError = useCallback((error: Error, errorInfo: ErrorInfo) => {
        console.error(`Error in screen "${currentScreen}":`, error, errorInfo);
    }, [currentScreen]);

    const renderedScreen = useMemo(() => {
        const CurrentScreen = currentRouteConfig?.component;

        if (!CurrentScreen) {
            if (__DEV__) console.error(`Screen "${currentScreen}" not found`);
            return <ErrorContainer />;
        }

        return (
            <ThemeProvider theme={theme}>
                <ErrorBoundary onError={handleError}>
                    <CurrentScreen {...screenPropsWithDefaults} />
                </ErrorBoundary>
            </ThemeProvider>
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
