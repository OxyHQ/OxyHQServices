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
import { createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';

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
    onAuthStateChange,
    storageKeyPrefix,
    baseURL,
    authWebUrl,
    authRedirectUri,
    queryClient: providedQueryClient,
}) => {

    // Simple storage initialization for query persistence
    const storageRef = useRef<StorageInterface | null>(null);
    const queryClientRef = useRef<ReturnType<typeof createQueryClient> | null>(null);
    const [queryClient, setQueryClient] = useState<ReturnType<typeof createQueryClient> | null>(null);

    useEffect(() => {
        if (providedQueryClient) {
            queryClientRef.current = providedQueryClient;
            setQueryClient(providedQueryClient);
            return;
        }

        // Initialize storage and create query client
        let mounted = true;
        createPlatformStorage()
            .then((storage) => {
                if (mounted && !queryClientRef.current) {
                    storageRef.current = storage;
                    const client = createQueryClient(storage);
                    queryClientRef.current = client;
                    setQueryClient(client);
                }
            })
            .catch((error) => {
                // If storage fails, create query client without persistence
                if (mounted && !queryClientRef.current) {
                    if (__DEV__) {
                        console.warn('[OxyProvider] Failed to initialize storage for query persistence', error);
                    }
                    const client = createQueryClient(null);
                    queryClientRef.current = client;
                    setQueryClient(client);
                }
            });

        return () => {
            mounted = false;
        };
    }, [providedQueryClient]);

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
                        
                        const unsubscribe = NetInfo.default.addEventListener((state: { isConnected: boolean | null }) => {
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
                                authWebUrl={authWebUrl}
                                authRedirectUri={authRedirectUri}
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
