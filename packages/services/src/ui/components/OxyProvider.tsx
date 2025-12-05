import { useEffect, useRef, type FC } from 'react';
import { AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import type { OxyProviderProps } from '../types/navigation';
import { OxyContextProvider } from '../context/OxyContext';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { setupFonts } from './FontLoader';
import BottomSheetRouter from './BottomSheetRouter';

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
    queryClient,
}) => {
    // contextOnly is retained for backwards compatibility while the UI-only
    // bottom sheet experience is removed. At the moment both modes behave the same.
    void contextOnly;

    // Initialize React Query Client (use provided client or create a default one once)
    const queryClientRef = useRef<QueryClient | null>(null);
    if (!queryClientRef.current) {
        const defaultClient = new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: 30_000,
                    gcTime: 5 * 60_000,
                    retry: 2,
                    refetchOnReconnect: true,
                    refetchOnWindowFocus: false,
                },
                mutations: {
                    retry: 1,
                },
            },
        });
        queryClientRef.current = queryClient ?? defaultClient;
    }

    // Hook React Query focus manager into React Native AppState
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            focusManager.setFocused(state === 'active');
        });
        return () => {
            subscription.remove();
        };
    }, []);

    // Ensure we have a valid QueryClient
    const client = queryClientRef.current;
    if (!client) {
        throw new Error('QueryClient initialization failed');
    }

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
            <QueryClientProvider client={client}>
            <OxyContextProvider
                    oxyServices={oxyServices as any}
                baseURL={baseURL}
                storageKeyPrefix={storageKeyPrefix}
                    onAuthStateChange={onAuthStateChange as any}
            >
                    <BottomSheetModalProvider>
                {children}
                        <BottomSheetRouter />
                    </BottomSheetModalProvider>
            </OxyContextProvider>
        </QueryClientProvider>
        </GestureHandlerRootView>
    );
};

export default OxyProvider;
