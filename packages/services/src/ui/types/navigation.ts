import type { ReactNode, RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { RouteName } from '../navigation/routes';
import type { User } from '@oxyhq/core';
import type { ClientSession } from '@oxyhq/core';

// Re-export RouteName from routes for convenience
export type { RouteName };

export interface StepController {
    canGoBack: () => boolean;
    goBack: () => void;
}

export interface BaseScreenProps {
    // Navigation props
    navigate?: (screen: RouteName, props?: Record<string, unknown>) => void;
    goBack?: () => void;
    onClose?: () => void;
    onAuthenticated?: (payload?: unknown) => void;
    
    // Theme props
    theme?: 'light' | 'dark' | string;
    
    // Step-based screen props
    initialStep?: number;
    stepControllerRef?: RefObject<StepController | null>;
    onStepChange?: (currentStep: number, totalSteps: number) => void;
    
    // Screen identification
    currentScreen?: RouteName;
    
    // Scroll control
    scrollTo?: (y: number, animated?: boolean) => void;
    
    // Form props (for sign in/up flows)
    username?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    userProfile?: unknown;
    
    // Note: OxyContext values (user, sessions, login, etc.) should be accessed via useOxy() hook
    // This keeps props minimal and follows React best practices
    
    // Allow additional props for screen-specific data
    [key: string]: unknown;
}

export interface OxyProviderProps {
    oxyServices?: unknown;
    children?: ReactNode;
    onAuthStateChange?: (user: unknown) => void;
    storageKeyPrefix?: string;
    /**
     * The app's Oxy OAuth client id / ApplicationCredential publicKey.
     * Required for the cross-app device sign-in flow: the QR / popup
     * sign-in registers a device-flow session via `POST /auth/session/create`,
     * which now identifies the requesting app by this real registered
     * client id. The central Oxy auth experience resolves and renders the
     * consent identity from it server-side. Without it the device sign-in
     * flow cannot start.
     */
    clientId?: string;
    baseURL?: string;
    authWebUrl?: string;
    authRedirectUri?: string;
    queryClient?: QueryClient;
}


