import type { ReactNode, RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export type RouteName = string;

export interface StepController {
    canGoBack: () => boolean;
    goBack: () => void;
}

export interface BaseScreenProps {
    navigate?: (screen: RouteName, props?: Record<string, unknown>) => void;
    goBack?: () => void;
    onClose?: () => void;
    onAuthenticated?: (payload?: unknown) => void;
    theme?: 'light' | 'dark' | string;
    initialStep?: number;
    currentScreen?: RouteName;
    username?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    userProfile?: unknown;
    oxyServices?: unknown;
    stepControllerRef?: RefObject<StepController | null>;
    [key: string]: unknown;
}

export interface OxyProviderProps {
    oxyServices: unknown;
    children?: ReactNode;
    contextOnly?: boolean;
    onAuthStateChange?: (isAuthenticated: boolean) => void;
    storageKeyPrefix?: string;
    baseURL?: string;
    queryClient?: QueryClient;
}



