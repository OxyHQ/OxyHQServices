import type { RouteName } from './routes';
import { isValidRoute } from './routes';
import { managerShowBottomSheet, managerCloseBottomSheet } from './bottomSheetManager';

/**
 * Public API for showing bottom sheets
 * This file breaks the require cycle by not importing OxyContext or BottomSheetRouter component
 * It only imports route validation and the manager
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

export const closeBottomSheet = (): void => {
    managerCloseBottomSheet();
};

