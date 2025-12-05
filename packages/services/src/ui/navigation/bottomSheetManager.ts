import type { RouteName } from './routes';

/**
 * Bottom Sheet Manager - Pure state management module
 * 
 * This module manages the global state for the bottom sheet router.
 * It has zero React dependencies and zero imports from routes/screens,
 * making it safe to import from anywhere without creating circular dependencies.
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

// Global state for bottom sheet router
let bottomSheetState: BottomSheetRouterState = {
    currentScreen: null,
    screenProps: {},
    currentStep: undefined,
    navigationHistory: [],
    isOpen: false,
};

let bottomSheetStateListeners: Set<(state: BottomSheetRouterState) => void> = new Set();

// Use a generic ref type to avoid importing React types
// The ref should have a current property with methods: present(), dismiss()
type BottomSheetRefObject = { current: { present: () => void; dismiss: () => void } | null } | null;
let bottomSheetRef: BottomSheetRefObject = null;

/**
 * Set the bottom sheet ref so showBottomSheet can control it
 */
export const setBottomSheetRef = (ref: BottomSheetRefObject) => {
    bottomSheetRef = ref;
};

/**
 * Update the bottom sheet state and notify all listeners
 */
export const updateBottomSheetState = (updates: Partial<BottomSheetRouterState>) => {
    bottomSheetState = { ...bottomSheetState, ...updates };
    bottomSheetStateListeners.forEach((listener) => listener(bottomSheetState));
};

/**
 * Subscribe to bottom sheet state changes
 * Returns an unsubscribe function
 */
export const subscribeToBottomSheetState = (listener: (state: BottomSheetRouterState) => void) => {
    bottomSheetStateListeners.add(listener);
    return () => {
        bottomSheetStateListeners.delete(listener);
    };
};

/**
 * Get the current bottom sheet state
 */
export const getBottomSheetState = (): BottomSheetRouterState => {
    return bottomSheetState;
};

/**
 * Show the bottom sheet with a specific screen (internal - no route validation)
 * Note: Route validation should be done by the caller before calling this function
 * Use bottomSheetApi.showBottomSheet() for the public API with validation
 * 
 * @param screen - The screen to navigate to
 * @param props - Props to pass to the screen
 * @param options - Navigation options
 * @param options.addToHistory - Whether to add current screen to history before navigating (default: true)
 * @param options.step - Step number for step-based screens (optional)
 */
export const managerShowBottomSheet = (
    screen: RouteName,
    props?: Record<string, unknown>,
    options?: { addToHistory?: boolean; step?: number },
): void => {
    const addToHistory = options?.addToHistory !== false; // Default to true
    
    // If adding to history and there's a current screen, push it to history
    if (addToHistory && bottomSheetState.currentScreen) {
        const historyEntry: NavigationHistoryEntry = {
            screen: bottomSheetState.currentScreen,
            props: { ...bottomSheetState.screenProps },
            step: bottomSheetState.currentStep,
        };
        
        bottomSheetState.navigationHistory.push(historyEntry);
    }
    
    // Update state with new screen
    // Determine the new step:
    // 1. If explicitly provided in options, use it
    // 2. If props contain initialStep, use it (for step navigation)
    // 3. If navigating to a different screen (addToHistory), reset step unless props has initialStep
    // 4. Otherwise, keep current step
    const newStep = options?.step ?? 
        (props?.initialStep !== undefined ? props.initialStep : 
         (addToHistory ? undefined : bottomSheetState.currentStep));
    
    updateBottomSheetState({
        currentScreen: screen,
        screenProps: props || {},
        currentStep: newStep,
        navigationHistory: bottomSheetState.navigationHistory,
        isOpen: true,
    });
};

/**
 * Close the bottom sheet (internal)
 * Use bottomSheetApi.closeBottomSheet() for the public API
 */
export const managerCloseBottomSheet = (): void => {
    updateBottomSheetState({
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
 * Navigate to a specific step within the current screen (for step-based screens)
 */
export const managerNavigateToStep = (step: number): void => {
    if (!bottomSheetState.currentScreen) {
        return;
    }
    
    updateBottomSheetState({
        currentStep: step,
    });
};

/**
 * Go back in navigation history
 * Returns true if back navigation was successful, false if history is empty
 */
export const managerGoBack = (): boolean => {
    // If there's history, pop and navigate to previous screen
    if (bottomSheetState.navigationHistory.length > 0) {
        const previous = bottomSheetState.navigationHistory[bottomSheetState.navigationHistory.length - 1];
        const newHistory = bottomSheetState.navigationHistory.slice(0, -1);
        
        // Update state directly (don't add to history since we're going back)
        bottomSheetState = {
            ...bottomSheetState,
            currentScreen: previous.screen,
            screenProps: previous.props,
            currentStep: previous.step,
            navigationHistory: newHistory,
            isOpen: true,
        };
        
        // Notify listeners
        bottomSheetStateListeners.forEach((listener) => listener(bottomSheetState));
        
        return true;
    }
    
    return false;
};

