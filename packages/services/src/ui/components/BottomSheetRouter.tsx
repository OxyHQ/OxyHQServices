import React, { useRef, useEffect, useCallback, useMemo, type ErrorInfo } from 'react';
import { BackHandler, View, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useStore } from 'zustand';
import type { RouteName } from '../navigation/routes';
import { getScreenComponent, isValidRoute } from '../navigation/routes';
import type { BaseScreenProps } from '../types/navigation';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import BottomSheet, { type BottomSheetRef } from './BottomSheet';
import {
    bottomSheetStore,
    getState,
    showBottomSheet,
    closeBottomSheet,
    goBack,
    updateState,
} from '../navigation/bottomSheetManager';

/** Error boundary to catch screen rendering failures (e.g. lazy require() throws) */
interface ScreenErrorBoundaryState {
    error: Error | null;
}

class ScreenErrorBoundary extends React.Component<
    { screenName: string; children: React.ReactNode },
    ScreenErrorBoundaryState
> {
    state: ScreenErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ScreenErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        if (__DEV__) {
            console.error(
                `[BottomSheetRouter] Screen "${this.props.screenName}" crashed:`,
                error,
                info.componentStack,
            );
        }
    }

    componentDidUpdate(prevProps: { screenName: string }): void {
        if (prevProps.screenName !== this.props.screenName && this.state.error) {
            this.setState({ error: null });
        }
    }

    render(): React.ReactNode {
        if (this.state.error) {
            return (
                <View style={errorStyles.container}>
                    <Text style={errorStyles.title}>Something went wrong</Text>
                    {__DEV__ && (
                        <Text style={errorStyles.message}>{this.state.error.message}</Text>
                    )}
                </View>
            );
        }
        return this.props.children;
    }
}

const errorStyles = StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
    message: { fontSize: 13, color: '#888', textAlign: 'center' },
});

export interface BottomSheetRouterProps {
    onScreenChange?: (screen: RouteName | null) => void;
    onDismiss?: () => void;
}

/**
 * BottomSheetRouter - Navigation container for bottom sheet screens
 */
const BottomSheetRouter: React.FC<BottomSheetRouterProps> = ({ onScreenChange, onDismiss }) => {
    const sheetRef = useRef<BottomSheetRef>(null);
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];
    const prevScreenRef = useRef<RouteName | null>(null);

    const { currentScreen, screenProps, currentStep, isOpen } = useStore(bottomSheetStore);

    const ScreenComponent = useMemo(() => {
        if (!currentScreen) return null;
        const component = getScreenComponent(currentScreen);
        if (__DEV__ && !component) {
            console.error(
                `[BottomSheetRouter] getScreenComponent("${currentScreen}") returned undefined — the screen's lazy require() likely failed.`,
            );
        }
        return component ?? null;
    }, [currentScreen]);

    // Notify screen changes
    useEffect(() => {
        if (prevScreenRef.current !== currentScreen) {
            onScreenChange?.(currentScreen);
            prevScreenRef.current = currentScreen;
        }
    }, [currentScreen, onScreenChange]);

    // Control visibility
    useEffect(() => {
        if (!sheetRef.current) return;

        if (isOpen) {
            sheetRef.current.present();
        } else {
            sheetRef.current.dismiss();
        }
    }, [isOpen]);

    // Android back button
    useEffect(() => {
        if (!isOpen) return;
        const handler = BackHandler.addEventListener('hardwareBackPress', () => {
            handleGoBack();
            return true;
        });
        return () => handler.remove();
    }, [isOpen]);

    const navigate = useCallback((screen: RouteName, props?: Record<string, unknown>) => {
        if (!isValidRoute(screen)) {
            if (__DEV__) console.warn(`[BottomSheetRouter] Invalid route: ${screen}`);
            return;
        }
        showBottomSheet({ screen, props });
    }, []);

    const handleGoBack = useCallback(() => {
        const state = getState();

        // Try history first
        if (state.history.length > 0) {
            goBack();
            return true;
        }

        // Try step back
        const step = state.currentStep ?? 0;
        if (step > 0) {
            updateState({
                currentStep: step - 1,
                screenProps: { ...state.screenProps, initialStep: step - 1 },
            });
            return true;
        }

        // Close
        closeBottomSheet();
        return true;
    }, []);

    const canDismiss = useCallback((): boolean => {
        const state = getState();
        if (state.history.length > 0) return false;
        const step = state.currentStep ?? 0;
        return step <= 0;
    }, []);

    const handleDismissAttempt = useCallback((): boolean => {
        if (!canDismiss()) {
            handleGoBack();
            return false;
        }
        return true;
    }, [canDismiss, handleGoBack]);

    const handleDismiss = useCallback(() => {
        closeBottomSheet();
        onDismiss?.();
    }, [onDismiss]);

    const handleStepChange = useCallback((step: number) => {
        const state = getState();
        updateState({
            currentStep: step,
            screenProps: { ...state.screenProps, initialStep: step },
        });
    }, []);

    const scrollTo = useCallback((y: number, animated?: boolean) => {
        sheetRef.current?.scrollTo(y, animated);
    }, []);

    const renderBackground = useCallback(
        (props: { style?: StyleProp<ViewStyle> }) => (
            <View style={[styles.background, { backgroundColor: colors.background }, props.style]} />
        ),
        [colors.background]
    );

    const screenPropsValue = useMemo((): BaseScreenProps & { scrollTo: typeof scrollTo } => {
        const { initialStep: _, ...rest } = screenProps;
        return {
            navigate,
            goBack: handleGoBack,
            onClose: closeBottomSheet,
            onAuthenticated: closeBottomSheet,
            theme: colorScheme ?? 'light',
            currentScreen: currentScreen ?? undefined,
            initialStep: currentStep ?? (screenProps?.initialStep as number | undefined),
            onStepChange: handleStepChange,
            scrollTo,
            ...rest,
        };
    }, [navigate, handleGoBack, colorScheme, currentScreen, currentStep, screenProps, handleStepChange, scrollTo]);

    return (
        <BottomSheet
            ref={sheetRef}
            enablePanDownToClose
            enableHandlePanningGesture
            backgroundComponent={renderBackground}
            style={styles.container}
            onDismiss={handleDismiss}
            onDismissAttempt={handleDismissAttempt}
        >
            {ScreenComponent && currentScreen && (
                <ScreenErrorBoundary screenName={currentScreen}>
                    <ScreenComponent {...screenPropsValue} />
                </ScreenErrorBoundary>
            )}
        </BottomSheet>
    );
};

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        width: '100%',
        alignSelf: 'center',
        marginHorizontal: 'auto',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
    },
});

export default React.memo(BottomSheetRouter);
