import type { RouteName } from './routes';
import { isValidRoute } from './routes';
import { createStore } from 'zustand/vanilla';

/**
 * Bottom Sheet Manager - Pure state management module
 * 
 * Uses Zustand (vanilla) for robust state management without React dependencies.
 * This ensures the manager can be imported safely anywhere.
 */

export interface NavigationHistoryEntry {
    screen: RouteName;
    props: Record<string, unknown>;
    step?: number; // For step-based screens
}

export interface BottomSheetRouterState {
    currentScreen: RouteName | null;
    screenProps: Record<string, unknown>;
    currentStep?: number; // Current step in step-based screen
    navigationHistory: NavigationHistoryEntry[];
    isOpen: boolean;
}

// Initial state
const initialState: BottomSheetRouterState = {
    currentScreen: null,
    screenProps: {},
    currentStep: undefined,
    navigationHistory: [],
    isOpen: false,
};

// Create vanilla store
export const bottomSheetStore = createStore<BottomSheetRouterState>(() => initialState);

// Use a generic ref type to avoid importing React types
type BottomSheetRefObject = { current: { present: () => void; dismiss: () => void } | null } | null;
let bottomSheetRef: BottomSheetRefObject = null;

/**
 * Set the bottom sheet ref so showBottomSheet can control it
 */
export const setBottomSheetRef = (ref: BottomSheetRefObject) => {
    bottomSheetRef = ref;
};

/**
 * Update the bottom sheet state
 * (Kept for backward compatibility, but prefer using store directly if possible)
 */
export const updateBottomSheetState = (updates: Partial<BottomSheetRouterState>) => {
    bottomSheetStore.setState((state) => ({ ...state, ...updates }));
};

/**
 * Subscribe to bottom sheet state changes
 * (Wrapper around store.subscribe for backward compatibility)
 */
export const subscribeToBottomSheetState = (listener: (state: BottomSheetRouterState) => void) => {
    return bottomSheetStore.subscribe(listener);
};

/**
 * Get the current bottom sheet state
 * (Wrapper around store.getState for backward compatibility)
 */
export const getBottomSheetState = (): BottomSheetRouterState => {
    return bottomSheetStore.getState();
};

/**
 * Show the bottom sheet with a specific screen (internal - no route validation)
 */
export const managerShowBottomSheet = (
    screen: RouteName,
    props?: Record<string, unknown>,
    options?: { addToHistory?: boolean; step?: number },
): void => {
    const currentState = bottomSheetStore.getState();
    const addToHistory = options?.addToHistory !== false; // Default to true
    
    // If adding to history and there's a current screen, push it to history
    if (addToHistory && currentState.currentScreen) {
        const historyEntry: NavigationHistoryEntry = {
            screen: currentState.currentScreen,
            props: { ...currentState.screenProps },
            step: currentState.currentStep,
        };
        
        // We need to create a new array for immutability
        const newHistory = [...currentState.navigationHistory, historyEntry];
        bottomSheetStore.setState({ navigationHistory: newHistory });
    }
    
    // Determine the new step
    const newStep = options?.step ?? 
        (props?.initialStep !== undefined ? props.initialStep : 
         (addToHistory ? undefined : currentState.currentStep));
    
    bottomSheetStore.setState({
        currentScreen: screen,
        screenProps: props || {},
        currentStep: newStep !== null && newStep !== undefined ? (newStep as number) : undefined,
        isOpen: true,
    });

    // Present the sheet after state update
    if (bottomSheetRef?.current) {
        bottomSheetRef.current.present();
    }
};

/**
 * Close the bottom sheet (internal)
 */
export const managerCloseBottomSheet = (): void => {
    bottomSheetStore.setState({
        currentScreen: null,
        screenProps: {},
        currentStep: undefined,
        navigationHistory: [],
        isOpen: false,
    });

    if (bottomSheetRef?.current) {
        bottomSheetRef.current.dismiss();
    }
};

/**
 * Go back in navigation history
 * Returns true if back navigation was successful, false if history is empty
 */
export const managerGoBack = (): boolean => {
    const currentState = bottomSheetStore.getState();

    // If there's history, pop and navigate to previous screen
    if (currentState.navigationHistory.length > 0) {
        const previous = currentState.navigationHistory[currentState.navigationHistory.length - 1];
        const newHistory = currentState.navigationHistory.slice(0, -1);
        
        bottomSheetStore.setState({
            currentScreen: previous.screen,
            screenProps: previous.props,
            currentStep: previous.step,
            navigationHistory: newHistory,
            isOpen: true,
        });
        
        return true;
    }
    
    return false;
};

/**
 * Public API for showing bottom sheets
 */
export const showBottomSheet = (
    screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> },
): void => {
    let screen: RouteName;
    let props: Record<string, unknown> = {};

    if (typeof screenOrConfig === 'string') {
        screen = screenOrConfig;
    } else {
        screen = screenOrConfig.screen;
        props = screenOrConfig.props || {};
    }

    if (!isValidRoute(screen)) {
        if (__DEV__) {
            console.warn(`[BottomSheetAPI] Invalid route: ${screen}`);
        }
        return;
    }

    managerShowBottomSheet(screen, props);
};

/**
 * Public API for closing bottom sheets
 */
export const closeBottomSheet = (): void => {
    managerCloseBottomSheet();
};


