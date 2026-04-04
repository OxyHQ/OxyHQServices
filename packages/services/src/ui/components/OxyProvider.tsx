import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type FC, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { OxyProviderProps } from '../types/navigation';
import { OxyContextProvider, type OxyContextProviderProps } from '../context/OxyContext';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { BloomThemeProvider } from '@oxyhq/bloom';
import { setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';
import { createQueryClient } from '../hooks/queryClient';
import { createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';

// Initialize fonts automatically
setupFonts();

// Detect if running on web
const isWeb = Platform.OS === 'web';

// Lazy-load optional components (avoids require() for ESM compatibility).
// The .then() extracts + casts the default export so that `lazy()` sees
// `Promise<{ default: ComponentType }>` instead of the full module namespace.
const LazyBottomSheetRouter = lazy((): Promise<{ default: ComponentType }> =>
    import('./BottomSheetRouter.js').then(
        (mod) => ({ default: mod.default as unknown as ComponentType }),
        (error) => {
            if (__DEV__) {
                console.error('[OxyProvider] Failed to load BottomSheetRouter:', error);
            }
            return { default: (() => null) as FC };
        },
    ),
);

const LazySignInModal = lazy((): Promise<{ default: ComponentType }> =>
    import('./SignInModal.js').then(
        (mod) => ({ default: mod.default as unknown as ComponentType }),
        () => ({ default: (() => null) as FC }),
    ),
);

/**
 * OxyProvider - Universal provider for Expo apps (native + web)
 *
 * Provides authentication, session management, query client, and UI overlays.
 * Does NOT wrap in SafeAreaProvider or GestureHandlerRootView — those are the
 * consuming app's responsibility.
 *
 * Usage:
 * ```tsx
 * import { OxyProvider, useAuth } from '@oxyhq/services';
 *
 * function App() {
 *   return (
 *     <SafeAreaProvider>
 *       <GestureHandlerRootView style={{ flex: 1 }}>
 *         <OxyProvider baseURL="https://api.oxy.so">
 *           <YourApp />
 *         </OxyProvider>
 *       </GestureHandlerRootView>
 *     </SafeAreaProvider>
 *   );
 * }
 *
 * function MyComponent() {
 *   const { isAuthenticated, user, signIn, signOut } = useAuth();
 *
 *   if (!isAuthenticated) {
 *     return <OxySignInButton />;
 *   }
 *   return <Text>Welcome, {user?.username}!</Text>;
 * }
 * ```
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
    themeMode = 'system',
    colorPreset,
}) => {

    // Dynamic KeyboardProvider for native (avoids require() for ESM compatibility)
    const [KBProvider, setKBProvider] = useState<FC<{ children: ReactNode }> | null>(null);
    useEffect(() => {
        if (isWeb) return;
        const moduleName = 'react-native-keyboard-controller';
        import(/* webpackIgnore: true */ moduleName)
            .then((mod) => setKBProvider(() => mod.KeyboardProvider))
            .catch(() => { /* KeyboardProvider not available */ });
    }, []);
    const KeyboardWrapper: FC<{ children: ReactNode }> = KBProvider ?? (({ children }) => <>{children}</>);

    // Simple storage initialization for query persistence
    const storageRef = useRef<StorageInterface | null>(null);
    const queryClientRef = useRef<ReturnType<typeof createQueryClient> | null>(null);
    // Initialize immediately if provided via prop to avoid a null-render frame
    const [queryClient, setQueryClient] = useState<ReturnType<typeof createQueryClient> | null>(() => {
        if (providedQueryClient) {
            queryClientRef.current = providedQueryClient;
            return providedQueryClient;
        }
        return null;
    });

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

    // Hook React Query focus manager into app state (native) or visibility (web)
    useEffect(() => {
        if (isWeb) {
            // Web: use document visibility
            const handleVisibilityChange = () => {
                focusManager.setFocused(document.visibilityState === 'visible');
            };
            document.addEventListener('visibilitychange', handleVisibilityChange);
            return () => {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            };
        }
            // Native: use AppState
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
                if (isWeb) {
                    // Web: use navigator.onLine
                    onlineManager.setOnline(navigator.onLine);
                    const handleOnline = () => onlineManager.setOnline(true);
                    const handleOffline = () => onlineManager.setOnline(false);

                    window.addEventListener('online', handleOnline);
                    window.addEventListener('offline', handleOffline);

                    cleanup = () => {
                        window.removeEventListener('online', handleOnline);
                        window.removeEventListener('offline', handleOffline);
                    };
                } else {
                    // Native: try to use NetInfo
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
        return null;
    }

    // Core content: QueryClient + OxyContext + UI overlays
    const coreContent = (
        <QueryClientProvider client={queryClient}>
            <BloomThemeProvider mode={themeMode} colorPreset={colorPreset}>
                <OxyContextProvider
                    oxyServices={oxyServices as OxyContextProviderProps['oxyServices']}
                    baseURL={baseURL}
                    authWebUrl={authWebUrl}
                    authRedirectUri={authRedirectUri}
                    storageKeyPrefix={storageKeyPrefix}
                    onAuthStateChange={onAuthStateChange as OxyContextProviderProps['onAuthStateChange']}
                >
                    {children}
                    <Suspense fallback={null}>
                        <LazyBottomSheetRouter />
                        <LazySignInModal />
                    </Suspense>
                    <Toaster />
                </OxyContextProvider>
            </BloomThemeProvider>
        </QueryClientProvider>
    );

    return (
        <KeyboardWrapper>
            {coreContent}
        </KeyboardWrapper>
    );
};

export default OxyProvider;
