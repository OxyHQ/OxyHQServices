import React, { useRef, useEffect, useCallback, useMemo, type ErrorInfo } from 'react';
import { BackHandler, Platform, View, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useStore } from 'zustand';
import type { RouteName } from '../navigation/routes';
import { getScreenComponent, getSheetConfig, isValidRoute } from '../navigation/routes';
import type { BaseScreenProps } from '../types/navigation';
import { useTheme } from '@oxyhq/bloom/theme';
import { Dialog } from '@oxyhq/bloom/dialog';
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
    message: { fontSize: 13, textAlign: 'center' },
});

/**
 * Responsive placement for `presentation: 'dialog'` routes: a bottom-sheet on
 * narrow viewports, a centered card at `md+` (≥768dp). Module-scoped so the
 * object identity is stable across renders (Bloom's placement resolver memoizes
 * on it). PhotoPickerSection keys its center-vs-bottom layout off the SAME `md`
 * breakpoint — keep the two in sync if this map changes.
 */
const DIALOG_PLACEMENT = { base: 'bottom', md: 'center' } as const;

export interface BottomSheetRouterProps {
    onScreenChange?: (screen: RouteName | null) => void;
    onDismiss?: () => void;
}

/**
 * BottomSheetRouter - Navigation container for bottom sheet screens
 */
const BottomSheetRouter: React.FC<BottomSheetRouterProps> = ({ onScreenChange, onDismiss }) => {
    const sheetRef = useRef<BottomSheetRef>(null);
    const theme = useTheme();
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

    // Route-level sheet config (which surface hosts the route, whether the sheet
    // provides its own ScrollView, etc.). Computed early so the visibility
    // effect can gate the in-tree sheet on the resolved presentation.
    const sheetConfig = useMemo(
        () => getSheetConfig(currentScreen, screenProps),
        [currentScreen, screenProps],
    );
    const isDialogPresentation = sheetConfig.presentation === 'dialog';

    // Notify screen changes
    useEffect(() => {
        if (prevScreenRef.current !== currentScreen) {
            onScreenChange?.(currentScreen);
            prevScreenRef.current = currentScreen;
        }
    }, [currentScreen, onScreenChange]);

    // Control visibility. The in-tree BottomSheet only ever presents for
    // 'sheet'-presentation routes — 'dialog' routes render in the Bloom
    // `<Dialog>` below, so the sheet stays dismissed for them (both surfaces
    // remain mounted, so the pick→crop dialog→sheet handoff has no unmount jank).
    useEffect(() => {
        if (!sheetRef.current) return;

        if (isOpen && !isDialogPresentation) {
            sheetRef.current.present();
        } else {
            sheetRef.current.dismiss();
        }
    }, [isOpen, isDialogPresentation]);

    // Android back button
    useEffect(() => {
        if (!isOpen) return;
        if (Platform.OS !== 'android') return;
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
            <View style={[styles.background, { backgroundColor: theme.colors.background }, props.style]} />
        ),
        [theme.colors.background]
    );

    const screenPropsValue = useMemo((): BaseScreenProps & { scrollTo: typeof scrollTo } => {
        const { initialStep: _, ...rest } = screenProps;
        return {
            navigate,
            goBack: handleGoBack,
            onClose: closeBottomSheet,
            onAuthenticated: closeBottomSheet,
            theme: theme.mode,
            currentScreen: currentScreen ?? undefined,
            initialStep: currentStep ?? (screenProps?.initialStep as number | undefined),
            onStepChange: handleStepChange,
            scrollTo,
            ...rest,
        };
    }, [navigate, handleGoBack, theme.mode, currentScreen, currentStep, screenProps, handleStepChange, scrollTo]);

    // The active screen, wrapped in its error boundary. Routed into EXACTLY ONE
    // surface (the in-tree sheet OR the Dialog) based on the resolved
    // presentation, so it never double-mounts.
    const screenNode =
        ScreenComponent && currentScreen ? (
            <ScreenErrorBoundary screenName={currentScreen}>
                <ScreenComponent {...screenPropsValue} />
            </ScreenErrorBoundary>
        ) : null;

    return (
        <>
            <BottomSheet
                ref={sheetRef}
                enablePanDownToClose
                enableHandlePanningGesture
                backgroundComponent={renderBackground}
                style={styles.container}
                onDismiss={handleDismiss}
                onDismissAttempt={handleDismissAttempt}
                scrollable={sheetConfig.scrollable}
                manualActivation={sheetConfig.manualActivation}
                dynamicBackdrop={sheetConfig.dynamicBackdrop}
                handleComponent={sheetConfig.handleComponent}
            >
                {!isDialogPresentation && screenNode}
            </BottomSheet>
            {/* Always-mounted responsive Dialog surface for `presentation:
                'dialog'` routes (currently the flagship photo picker). It stays
                inert (`open={false}`, no child) for the ~28 sheet routes, so they
                keep byte-for-byte identical behavior. `contentPadding={0}` +
                the full-bleed black, rounded, clipped surface let the picker
                paint edge-to-edge; `dismissOnBackdrop={false}` keeps the
                controlled open state authoritative (dismissal flows through the
                store, matching OxyAccountDialog). */}
            <Dialog
                open={isOpen && isDialogPresentation}
                onClose={handleDismiss}
                placement={DIALOG_PLACEMENT}
                dismissOnBackdrop={false}
                contentPadding={0}
                maxWidth={640}
                maxHeightRatio={0.9}
                style={styles.dialogSurface}
                panelStyle={styles.dialogSurface}
                label={currentScreen ?? undefined}
            >
                {isDialogPresentation ? screenNode : null}
            </Dialog>
        </>
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
    // Full-bleed black surface for `presentation: 'dialog'` routes. `overflow:
    // 'hidden'` clips the picker's edge-to-edge black content to the panel's
    // rounded corners (Dialog supplies the radius per placement); the black
    // fill covers any sub-pixel gap behind the picker during entrance.
    dialogSurface: {
        backgroundColor: '#000000',
        overflow: 'hidden',
    },
});

export default React.memo(BottomSheetRouter);
