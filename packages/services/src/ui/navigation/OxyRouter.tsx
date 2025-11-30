import type React from 'react';
import { useState, useEffect, useCallback, memo, useMemo, useRef, type ErrorInfo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
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
    // History now stores both screen and props snapshot for step navigation support
    const [screenHistory, setScreenHistory] = useState<Array<{ screen: RouteName; props: Record<string, unknown> }>>(
        [{ screen: initialScreen, props: {} }]
    );
    const [screenPropsMap, setScreenPropsMap] = useState<Partial<Record<RouteName, Record<string, unknown>>>>(
        () => ({ [initialScreen]: {} })
    );
    // Navigation version to force re-renders when props change on same screen
    const [navigationVersion, setNavigationVersion] = useState(0);

    // Refs to track current state for use in navigate callback (avoids stale closures and nested setState)
    const currentScreenRef = useRef<RouteName>(initialScreen);
    const screenPropsMapRef = useRef<Partial<Record<RouteName, Record<string, unknown>>>>({ [initialScreen]: {} });
    const screenHistoryRef = useRef<Array<{ screen: RouteName; props: Record<string, unknown> }>>([{ screen: initialScreen, props: {} }]);

    // Keep refs in sync with state
    useEffect(() => {
        currentScreenRef.current = currentScreen;
    }, [currentScreen]);

    useEffect(() => {
        screenPropsMapRef.current = screenPropsMap;
    }, [screenPropsMap]);

    useEffect(() => {
        screenHistoryRef.current = screenHistory;
    }, [screenHistory]);

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

        const isSameScreen = currentScreenRef.current === screen;

        // Read current state from refs to avoid nested setState calls
        // This ensures coordinated updates without violating React's state update pattern
        const currentPropsMap = screenPropsMapRef.current;
        const currentHistory = screenHistoryRef.current;

        const existingProps = isSameScreen ? (currentPropsMap[screen] || {}) : {};
        const mergedProps = isSameScreen
            ? { ...existingProps, ...props }
            : props;

        if (__DEV__) {
            console.log('OxyRouter: navigation', {
                isSameScreen,
                existingProps,
                props,
                mergedProps,
                hasUsername: !!(mergedProps as any).username,
                hasUserProfile: !!(mergedProps as any).userProfile,
                hasInitialStep: !!(mergedProps as any).initialStep,
            });
        }

        // Calculate new history entry (if needed)
        const shouldUpdateHistory = !isSameScreen || Object.keys(props).length > 0;
        let newHistory = currentHistory;

        if (shouldUpdateHistory) {
            if (!isSameScreen) {
                // Different screen - add to history with merged props
                newHistory = [...currentHistory, { screen, props: mergedProps }];
            } else if (Object.keys(props).length > 0) {
                // Same screen with props (step navigation) - store existing props snapshot before merging
                // This allows us to restore to previous step when going back
                if (__DEV__) {
                    console.log('OxyRouter: step navigation - storing snapshot', {
                        currentProps: existingProps,
                        newProps: mergedProps,
                        hasUsername: !!(mergedProps as any).username,
                        hasUserProfile: !!(mergedProps as any).userProfile,
                        hasInitialStep: !!(mergedProps as any).initialStep,
                    });
                }
                newHistory = [...currentHistory, { screen, props: { ...existingProps } }];
            }
        }

        // Update all states separately - React will batch these updates together
        // This avoids nested setState calls which can cause race conditions
        setScreenPropsMap({ ...currentPropsMap, [screen]: mergedProps });

        if (shouldUpdateHistory) {
            setScreenHistory(newHistory);
        }

        if (!isSameScreen) {
            // Different screen - update screen and increment version
            setCurrentScreen(screen);
            setNavigationVersion(v => v + 1);
        } else if (Object.keys(props).length > 0) {
            // Same screen with props - update screen and increment version for re-render
            setCurrentScreen(screen);
            setNavigationVersion(v => v + 1);
        } else {
            // Same screen, no props - just update screen (no version increment needed)
            setCurrentScreen(screen);
        }
    }, []);

    const goBack = useCallback(() => {
        setScreenHistory(prev => {
            if (prev.length <= 1) {
                if (__DEV__) {
                    console.log('OxyRouter: goBack - no history, closing');
                }
                onClose?.();
                return prev;
            }
            const newHistory = prev.slice(0, -1);
            const previousEntry = newHistory[newHistory.length - 1];
            const currentEntry = prev[prev.length - 1];

            if (__DEV__) {
                console.log('OxyRouter: goBack', {
                    from: currentEntry,
                    to: previousEntry,
                    historyLength: newHistory.length,
                });
            }

            // Restore screen and props from previous history entry
            setCurrentScreen(previousEntry.screen);
            setScreenPropsMap(prevProps => ({
                ...prevProps,
                [previousEntry.screen]: previousEntry.props,
            }));
            setNavigationVersion(v => v + 1); // Force re-render with restored props

            return newHistory;
        });
    }, [onClose]);

    const canGoBack = useCallback(() => {
        return screenHistory.length > 1;
    }, [screenHistory.length]);

    // ========================================================================
    // Back Gesture Handler
    // ========================================================================
    // Track if we've already handled a gesture to prevent double navigation
    const gestureHandledRef = useRef(false);

    // Create Pan gesture to detect left-to-right swipe (back gesture)
    // This intercepts gestures BEFORE React Native's default blur behavior
    const backGesture = useMemo(() => {
        return Gesture.Pan()
            .activeOffsetX(10) // Activate when horizontal movement exceeds 10px
            .failOffsetY([-50, 50]) // Allow some vertical movement but prioritize horizontal
            .onStart((event) => {
                // Reset gesture handled flag when gesture starts
                gestureHandledRef.current = false;

                // If gesture starts from left edge (first 20px), we might be doing a back gesture
                // Navigate immediately on gesture start if it's clearly horizontal
                if (event.x < 20) {
                    // Priority 1: Check if current screen has step history
                    if (stepControllerRef?.current?.canGoBack()) {
                        gestureHandledRef.current = true;
                        stepControllerRef.current.goBack();
                        return;
                    }

                    // Priority 2: Check if router has navigation history
                    if (canGoBack()) {
                        gestureHandledRef.current = true;
                        goBack();
                        return;
                    }
                }
            })
            .onUpdate((event) => {
                // Detect left-to-right swipe (translationX > 30px threshold)
                // Navigate immediately when threshold is reached
                if (!gestureHandledRef.current && event.translationX > 30) {
                    gestureHandledRef.current = true;

                    // Priority 1: Check if current screen has step history
                    if (stepControllerRef?.current?.canGoBack()) {
                        stepControllerRef.current.goBack();
                        return;
                    }

                    // Priority 2: Check if router has navigation history
                    if (canGoBack()) {
                        goBack();
                        return;
                    }
                }
            })
            .onEnd(() => {
                // Reset flag when gesture ends
                gestureHandledRef.current = false;
            });
    }, [goBack, canGoBack, stepControllerRef]);

    // ========================================================================
    // Ref Exposure
    // ========================================================================
    useEffect(() => {
        if (!navigationRef) return;
        try {
            navigationRef.current = navigate;
            if (__DEV__) console.log('OxyRouter: navigationRef set');
        } catch (error) {
            if (__DEV__) console.warn('OxyRouter: Failed to set navigationRef', error);
        }
        return () => {
            if (navigationRef) {
                try {
                    navigationRef.current = null;
                    if (__DEV__) console.log('OxyRouter: navigationRef cleared');
                } catch (error) {
                    if (__DEV__) console.warn('OxyRouter: Failed to clear navigationRef', error);
                }
            }
        };
    }, [navigate, navigationRef]);

    useEffect(() => {
        if (!routerRef) return;
        try {
            routerRef.current = { goBack, canGoBack };
        } catch (error) {
            if (__DEV__) console.warn('OxyRouter: Failed to set routerRef', error);
        }
        return () => {
            if (routerRef) {
                try {
                    routerRef.current = null;
                } catch (error) {
                    if (__DEV__) console.warn('OxyRouter: Failed to clear routerRef', error);
                }
            }
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
    const screenProps = useMemo(() => {
        const props = screenPropsMap[currentScreen] || EMPTY_PROPS;
        if (__DEV__) {
            console.log('OxyRouter: screenProps computed', {
                currentScreen,
                props,
                navigationVersion,
                hasUsername: !!(props as any).username,
                hasUserProfile: !!(props as any).userProfile,
                hasInitialStep: !!(props as any).initialStep,
            });
        }
        return props;
    }, [screenPropsMap, currentScreen, navigationVersion]);

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
            currentScreen, // Pass current screen name for router-based step navigation
            ...screenProps,
        }),
        [oxyServices, navigate, goBack, onClose, onAuthenticated, theme, containerWidth, stepControllerRef, currentScreen, screenProps]
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

        // Create a key that includes navigation version to force re-render when props change on same screen
        const screenKey = `${currentScreen}-${navigationVersion}`;

        return (
            <ThemeProvider theme={theme}>
                <ErrorBoundary onError={handleError}>
                    <CurrentScreen key={screenKey} {...screenPropsWithDefaults} />
                </ErrorBoundary>
            </ThemeProvider>
        );
    }, [currentRouteConfig, currentScreen, screenPropsWithDefaults, handleError, theme, navigationVersion]);

    return (
        <GestureDetector gesture={backGesture}>
            <View style={styles.container}>
                {renderedScreen}
            </View>
        </GestureDetector>
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
