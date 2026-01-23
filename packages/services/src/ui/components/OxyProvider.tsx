import { useEffect, useRef, useState, type FC } from 'react';
import { AppState, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { OxyProviderProps } from '../types/navigation';
import { OxyContextProvider } from '../context/OxyContext';
import { QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';
import { createQueryClient } from '../hooks/queryClient';
import { createPlatformStorage, type StorageInterface } from '../utils/storageHelpers';

// Initialize fonts automatically
setupFonts();

// Detect if running on web
const isWeb = Platform.OS === 'web';

// Conditionally import components
let KeyboardProvider: any = ({ children }: any) => children;
let BottomSheetRouter: any = null;

// KeyboardProvider only on native
if (!isWeb) {
    try {
        KeyboardProvider = require('react-native-keyboard-controller').KeyboardProvider;
    } catch {
        // KeyboardProvider not available
    }
}

// BottomSheetRouter works on all platforms
try {
    BottomSheetRouter = require('./BottomSheetRouter').default;
} catch {
    // BottomSheetRouter not available
}

/**
 * OxyProvider - Universal provider for Expo apps (native + web)
 *
 * Zero-config authentication and session management:
 * - Native (iOS/Android): Keychain-based identity, bottom sheet auth UI
 * - Web: FedCM cross-domain SSO, popup fallback
 *
 * Usage:
 * ```tsx
 * import { OxyProvider, useAuth } from '@oxyhq/services';
 *
 * function App() {
 *   return (
 *     <OxyProvider baseURL="https://api.oxy.so">
 *       <YourApp />
 *     </OxyProvider>
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
        } else {
            // Native: use AppState
            const subscription = AppState.addEventListener('change', (state) => {
                focusManager.setFocused(state === 'active');
            });
            return () => {
                subscription.remove();
            };
        }
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

    // Core content that works on all platforms
    const coreContent = (
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
                {/* Only render bottom sheet router on native */}
                {BottomSheetRouter && <BottomSheetRouter />}
                <Toaster />
            </OxyContextProvider>
        </QueryClientProvider>
    );

    // On web, minimal wrappers (GestureHandler and SafeArea work via react-native-web)
    if (isWeb) {
        return (
            <SafeAreaProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                    {coreContent}
                </GestureHandlerRootView>
            </SafeAreaProvider>
        );
    }

    // On native, full wrappers including KeyboardProvider
    return (
        <SafeAreaProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                    {coreContent}
                </KeyboardProvider>
            </GestureHandlerRootView>
        </SafeAreaProvider>
    );
};

export default OxyProvider;
