import type { ReactNode, RefObject } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { RouteName } from '../navigation/routes';
import type { User } from '../../models/interfaces';
import type { ClientSession } from '../../models/session';

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
    
    // Form props (for sign in/up flows)
    username?: string;
    email?: string;
    password?: string;
    confirmPassword?: string;
    userProfile?: unknown;
    
    // OxyContext values - injected by BottomSheetRouter
    // These replace the need for screens to import useOxy()
    user?: User | null;
    sessions?: ClientSession[];
    activeSessionId?: string | null;
    isAuthenticated?: boolean;
    isLoading?: boolean;
    isTokenReady?: boolean;
    error?: string | null;
    currentLanguage?: string;
    currentLanguageName?: string;
    currentNativeLanguageName?: string;
    login?: (username: string, password: string, deviceName?: string) => Promise<User>;
    logout?: (targetSessionId?: string) => Promise<void>;
    logoutAll?: () => Promise<void>;
    signUp?: (username: string, email: string, password: string) => Promise<User>;
    completeMfaLogin?: (mfaToken: string, code: string) => Promise<User>;
    switchSession?: (sessionId: string) => Promise<void>;
    removeSession?: (sessionId: string) => Promise<void>;
    refreshSessions?: () => Promise<void>;
    setLanguage?: (languageId: string) => Promise<void>;
    getDeviceSessions?: () => Promise<
        Array<{
            sessionId: string;
            deviceId: string;
            deviceName?: string;
            lastActive?: string;
            expiresAt?: string;
        }>
    >;
    logoutAllDeviceSessions?: () => Promise<void>;
    updateDeviceName?: (deviceName: string) => Promise<void>;
    oxyServices?: unknown;
    
    // Allow additional props
    [key: string]: unknown;
}

export interface OxyProviderProps {
    oxyServices?: unknown;
    children?: ReactNode;
    contextOnly?: boolean;
    onAuthStateChange?: (user: unknown) => void;
    storageKeyPrefix?: string;
    baseURL?: string;
    queryClient?: QueryClient;
}



