import { useEffect, useRef, type FC } from 'react';
import { AppState } from 'react-native';
import type { OxyProviderProps } from '../navigation/types';
import { OxyContextProvider } from '../context/OxyContext';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { setupFonts } from './FontLoader';

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
        queryClientRef.current = queryClient ?? new QueryClient({
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

    return (
        <QueryClientProvider client={queryClientRef.current}>
            <OxyContextProvider
                oxyServices={oxyServices}
                baseURL={baseURL}
                storageKeyPrefix={storageKeyPrefix}
                onAuthStateChange={onAuthStateChange}
            >
                {children}
            </OxyContextProvider>
        </QueryClientProvider>
    );
};

export default OxyProvider;
export { default as OxyRouter } from '../navigation/OxyRouter';
