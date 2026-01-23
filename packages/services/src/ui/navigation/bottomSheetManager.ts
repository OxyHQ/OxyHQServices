import type { RouteName } from './routes';
import { isValidRoute } from './routes';
import { createStore } from 'zustand/vanilla';

/**
 * Bottom Sheet State Manager
 */

export interface BottomSheetState {
    currentScreen: RouteName | null;
    screenProps: Record<string, unknown>;
    currentStep?: number;
    history: Array<{ screen: RouteName; props: Record<string, unknown>; step?: number }>;
    isOpen: boolean;
}

const initialState: BottomSheetState = {
    currentScreen: null,
    screenProps: {},
    currentStep: undefined,
    history: [],
    isOpen: false,
};

export const bottomSheetStore = createStore<BottomSheetState>(() => initialState);

export const getState = () => bottomSheetStore.getState();

export const showBottomSheet = (
    screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> },
): void => {
    const screen = typeof screenOrConfig === 'string' ? screenOrConfig : screenOrConfig.screen;
    const props = typeof screenOrConfig === 'string' ? {} : (screenOrConfig.props || {});

    if (!isValidRoute(screen)) {
        if (__DEV__) console.warn(`[BottomSheet] Invalid route: ${screen}`);
        return;
    }

    const state = bottomSheetStore.getState();

    // Push current screen to history if navigating to different screen
    if (state.currentScreen && state.currentScreen !== screen) {
        bottomSheetStore.setState({
            history: [...state.history, {
                screen: state.currentScreen,
                props: state.screenProps,
                step: state.currentStep,
            }],
        });
    }

    bottomSheetStore.setState({
        currentScreen: screen,
        screenProps: props,
        currentStep: typeof props.initialStep === 'number' ? props.initialStep : undefined,
        isOpen: true,
    });
};

export const closeBottomSheet = (): void => {
    bottomSheetStore.setState(initialState);
};

export const goBack = (): boolean => {
    const { history } = bottomSheetStore.getState();

    if (history.length > 0) {
        const prev = history[history.length - 1];
        bottomSheetStore.setState({
            currentScreen: prev.screen,
            screenProps: prev.props,
            currentStep: prev.step,
            history: history.slice(0, -1),
        });
        return true;
    }

    return false;
};

export const updateState = (updates: Partial<BottomSheetState>) => {
    bottomSheetStore.setState((state) => ({ ...state, ...updates }));
};
