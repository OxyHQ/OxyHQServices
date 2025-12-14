import { useEffect, useRef, useState, type FC } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import type { OxyProviderProps } from '../types/navigation';
import { OxyContextProvider } from '../context/OxyContext';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { setupFonts } from './FontLoader';
import BottomSheetRouter from './BottomSheetRouter';
import { Toaster } from '../../lib/sonner';
import { createQueryClient } from '../hooks/queryClient';
import { useStorage } from '../hooks/useStorage';

// Initialize fonts automatically
setupFonts();

/**
 * OxyProvider component
 *
 * Provides the authentication/session context used across the app.
 * UI composition (e.g. OxyRouter inside a bottom sheet) can be added externally.
 */
const OxyProvider: FC<OxyProviderProps> = ({
    oxyServices,
    children,
    contextOnly = false,
    onAuthStateChange,
    storageKeyPrefix,
    baseURL,
    queryClient: providedQueryClient,
}) => {
    // contextOnly is retained for backwards compatibility while the UI-only
    // bottom sheet experience is removed. At the moment both modes behave the same.
    void contextOnly;

    // Get storage for query persistence
    const { storage, isReady: isStorageReady } = useStorage();
    
    // Initialize React Query Client with persistence
    const queryClientRef = useRef<ReturnType<typeof createQueryClient> | null>(null);
    const [queryClient, setQueryClient] = useState<ReturnType<typeof createQueryClient> | null>(null);

    useEffect(() => {
        if (providedQueryClient) {
            queryClientRef.current = providedQueryClient;
            setQueryClient(providedQueryClient);
        } else if (isStorageReady) {
            // Create query client with persistence once storage is ready
            if (!queryClientRef.current) {
                const client = createQueryClient(storage);
                queryClientRef.current = client;
                setQueryClient(client);
            }
        }
    }, [providedQueryClient, isStorageReady, storage]);

    // Hook React Query focus manager into React Native AppState
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            focusManager.setFocused(state === 'active');
        });
        return () => {
            subscription.remove();
        };
    }, []);

    // Setup network status monitoring for offline detection
    useEffect(() => {
        let cleanup: (() => void) | undefined;

        const setupNetworkMonitoring = async () => {
            try {
                // For React Native, try to use NetInfo
                if (typeof window === 'undefined' || (typeof navigator !== 'undefined' && navigator.product === 'ReactNative')) {
                    try {
                        const NetInfo = await import('@react-native-community/netinfo');
                        const state = await NetInfo.default.fetch();
                        onlineManager.setOnline(state.isConnected ?? true);
                        
                        const unsubscribe = NetInfo.default.addEventListener(state => {
                            onlineManager.setOnline(state.isConnected ?? true);
                        });
                        
                        cleanup = () => unsubscribe();
                    } catch {
                        // NetInfo not available, default to online
                        onlineManager.setOnline(true);
                    }
                } else {
                    // For web, use navigator.onLine
                    onlineManager.setOnline(navigator.onLine);
                    const handleOnline = () => onlineManager.setOnline(true);
                    const handleOffline = () => onlineManager.setOnline(false);
                    
                    window.addEventListener('online', handleOnline);
                    window.addEventListener('offline', handleOffline);
                    
                    cleanup = () => {
                        window.removeEventListener('online', handleOnline);
                        window.removeEventListener('offline', handleOffline);
                    };
                }
            } catch (error) {
                // Default to online if detection fails
                onlineManager.setOnline(true);
            }
        };

        setupNetworkMonitoring();

        return () => {
            cleanup?.();
        };
    }, []);

    // Ensure we have a valid QueryClient
    if (!queryClient) {
        // Return loading state or fallback
        return null;
    }

    return (
        <SafeAreaProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                    {queryClient && (
                        <QueryClientProvider client={queryClient}>
                            <OxyContextProvider
                                oxyServices={oxyServices as any}
                                baseURL={baseURL}
                                storageKeyPrefix={storageKeyPrefix}
                                onAuthStateChange={onAuthStateChange as any}
                            >
                                {children}
                                <BottomSheetRouter />
                                <Toaster />
                            </OxyContextProvider>
                        </QueryClientProvider>
                    )}
                </KeyboardProvider>
            </GestureHandlerRootView>
        </SafeAreaProvider>
    );
};

export default OxyProvider;
