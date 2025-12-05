import { useCallback, useEffect, useState } from 'react';
import type { RouteName } from '../navigation/routes';
import {
    showBottomSheet as globalShowBottomSheet,
    closeBottomSheet as globalCloseBottomSheet,
    subscribeToBottomSheetState,
    type BottomSheetRouterState,
} from '../components/BottomSheetRouter';

export interface UseBottomSheetReturn {
    showBottomSheet: (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => void;
    closeBottomSheet: () => void;
    isOpen: boolean;
    currentScreen: RouteName | null;
}

/**
 * Hook to interact with the bottom sheet router
 * Provides functions to show/close bottom sheets and track their state
 */
export const useBottomSheet = (): UseBottomSheetReturn => {
    const [state, setState] = useState<BottomSheetRouterState>({
        currentScreen: null,
        screenProps: {},
        isOpen: false,
    });

    // Subscribe to bottom sheet state changes
    useEffect(() => {
        const unsubscribe = subscribeToBottomSheetState((newState) => {
            setState(newState);
        });

        return unsubscribe;
    }, []);

    const showBottomSheet = useCallback(
        (screenOrConfig: RouteName | { screen: RouteName; props?: Record<string, unknown> }) => {
            globalShowBottomSheet(screenOrConfig);
        },
        [],
    );

    const closeBottomSheet = useCallback(() => {
        globalCloseBottomSheet();
    }, []);

    return {
        showBottomSheet,
        closeBottomSheet,
        isOpen: state.isOpen,
        currentScreen: state.currentScreen,
    };
};

export default useBottomSheet;

