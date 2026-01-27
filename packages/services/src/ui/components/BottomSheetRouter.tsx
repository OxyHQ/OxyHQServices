import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { BackHandler, View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
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

    const ScreenComponent = useMemo(
        () => (currentScreen ? getScreenComponent(currentScreen) : null),
        [currentScreen]
    );

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
            {ScreenComponent && currentScreen && <ScreenComponent {...screenPropsValue} />}
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
