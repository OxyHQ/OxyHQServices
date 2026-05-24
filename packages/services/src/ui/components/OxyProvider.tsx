import { lazy, Suspense, useEffect, useRef, useState, type ComponentType, type FC, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { OxyProviderProps } from '../types/navigation';
import { OxyContextProvider, type OxyContextProviderProps } from '../context/OxyContext';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { BloomThemeProvider } from '@oxyhq/bloom';
import { setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';
import { attachQueryPersistence, createQueryClient } from '../hooks/queryClient';
import { createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';

// Initialize fonts automatically
setupFonts();

// Detect if running on web
const isWeb = Platform.OS === 'web';

// Variable indirection: the module name is computed at runtime so Metro's
// static analyzer cannot trace this into the web bundle. Native-only.
const KEYBOARD_CONTROLLER_MODULE = 'react-native-keyboard-controller';

// Lazy-load optional components (avoids require() for ESM compatibility).
// The .then() extracts + casts the default export so that `lazy()` sees
// `Promise<{ default: ComponentType }>` instead of the full module namespace.
const LazyBottomSheetRouter = lazy((): Promise<{ default: ComponentType }> =>
    import('./BottomSheetRouter').then(
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
    import('./SignInModal').then(
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

    // Dynamic KeyboardProvider for native. Uses variable indirection
    // (KEYBOARD_CONTROLLER_MODULE) so Metro's static analyzer cannot trace
    // the import into the web bundle. On web, the runtime guard short-circuits
    // before the import runs.
    const [KBProvider, setKBProvider] = useState<FC<{ children: ReactNode }> | null>(null);
    useEffect(() => {
        if (isWeb) return;
        const moduleName = KEYBOARD_CONTROLLER_MODULE;
        import(moduleName)
            .then((mod) => setKBProvider(() => mod.KeyboardProvider))
            .catch((error) => {
                if (__DEV__) {
                    console.warn('[OxyProvider] react-native-keyboard-controller not available, skipping keyboard support', error);
                }
            });
    }, []);
    const KeyboardWrapper: FC<{ children: ReactNode }> = KBProvider ?? (({ children }) => <>{children}</>);

    // Storage + persistence wiring.
    //
    // We MUST await the restore() promise before exposing the QueryClient to
    // children — otherwise the first render sees an empty cache and any
    // <Suspense> queries or `enabled: !!cached` gates would skip the offline
    // hit. Once the persisted blob has been hydrated (or definitively failed
    // to hydrate), we mark the client ready and unblock rendering.
    const storageRef = useRef<StorageInterface | null>(null);
    const queryClientRef = useRef<ReturnType<typeof createQueryClient> | null>(null);
    const persistenceUnsubRef = useRef<(() => void) | null>(null);

    // If the consumer supplied their own QueryClient we use it as-is and skip
    // persistence — their host app owns that lifecycle.
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

        let mounted = true;

        const bootstrap = async (): Promise<void> => {
            let storage: StorageInterface | null = null;
            try {
                storage = await createPlatformStorage();
            } catch (error) {
                if (__DEV__) {
                    console.warn('[OxyProvider] Failed to initialize storage for query persistence', error);
                }
            }

            if (!mounted || queryClientRef.current) return;

            storageRef.current = storage;
            const client = createQueryClient();
            const { restored, unsubscribe } = attachQueryPersistence(client, storage);
            persistenceUnsubRef.current = unsubscribe;

            // Block first render until the persisted cache is restored so
            // offline reads land synchronously on the very first paint.
            await restored;

            if (!mounted) {
                unsubscribe();
                return;
            }

            queryClientRef.current = client;
            setQueryClient(client);
        };

        bootstrap();

        return () => {
            mounted = false;
            persistenceUnsubRef.current?.();
            persistenceUnsubRef.current = null;
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
            {/*
              * OxyProvider mounts BloomThemeProvider internally as a convenience —
              * consumers do NOT need to wrap their own BloomThemeProvider. Any
              * outer BloomThemeProvider from the consuming app will be shadowed
              * by this one. Pass `themeMode` and `colorPreset` props instead.
              */}
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
