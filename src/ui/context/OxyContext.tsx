import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { OxyServices } from '../../core';
import { User, LoginResponse } from '../../models/interfaces';

// Define the context shape
export interface OxyContextState {
    // Authentication state
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;

    // Auth methods
    login: (username: string, password: string) => Promise<User>;
    logout: () => Promise<void>;
    signUp: (username: string, email: string, password: string) => Promise<User>;

    // Access to services
    oxyServices: OxyServices;
    bottomSheetRef?: React.RefObject<any>;

    // Methods to directly control the bottom sheet
    showBottomSheet?: (screen?: string) => void;
    hideBottomSheet?: () => void;
}

// Create the context with default values
const OxyContext = createContext<OxyContextState | null>(null);

// Props for the OxyContextProvider
export interface OxyContextProviderProps {
    children: ReactNode;
    oxyServices: OxyServices;
    storageKeyPrefix?: string;
    onAuthStateChange?: (user: User | null) => void;
    bottomSheetRef?: React.RefObject<any>;
}

// Platform storage implementation
interface StorageInterface {
    getItem: (key: string) => Promise<string | null>;
    setItem: (key: string, value: string) => Promise<void>;
    removeItem: (key: string) => Promise<void>;
    clear: () => Promise<void>;
}

// Web localStorage implementation
class WebStorage implements StorageInterface {
    async getItem(key: string): Promise<string | null> {
        return localStorage.getItem(key);
    }

    async setItem(key: string, value: string): Promise<void> {
        localStorage.setItem(key, value);
    }

    async removeItem(key: string): Promise<void> {
        localStorage.removeItem(key);
    }

    async clear(): Promise<void> {
        localStorage.clear();
    }
}

// React Native AsyncStorage implementation
// This will be dynamically imported only in React Native environment
let AsyncStorage: StorageInterface;

// Determine the platform and set up storage
const isReactNative = (): boolean => {
    return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
};

// Get appropriate storage for the platform
const getStorage = async (): Promise<StorageInterface> => {
    if (isReactNative()) {
        // Dynamically import AsyncStorage only in React Native environment
        if (!AsyncStorage) {
            try {
                const asyncStorageModule = await import('@react-native-async-storage/async-storage');
                AsyncStorage = asyncStorageModule.default;
            } catch (error) {
                console.error('Failed to import AsyncStorage:', error);
                throw new Error('AsyncStorage is required in React Native environment');
            }
        }
        return AsyncStorage;
    }

    // Default to web storage
    return new WebStorage();
};

// Storage keys
const getStorageKeys = (prefix = 'oxy') => ({
    accessToken: `${prefix}_access_token`,
    refreshToken: `${prefix}_refresh_token`,
    user: `${prefix}_user`,
});

export const OxyContextProvider: React.FC<OxyContextProviderProps> = ({
    children,
    oxyServices,
    storageKeyPrefix = 'oxy',
    onAuthStateChange,
    bottomSheetRef,
}) => {
    // Authentication state
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [storage, setStorage] = useState<StorageInterface | null>(null);

    // Storage keys
    const keys = getStorageKeys(storageKeyPrefix);

    // Initialize storage
    useEffect(() => {
        const initStorage = async () => {
            try {
                const platformStorage = await getStorage();
                setStorage(platformStorage);
            } catch (error) {
                console.error('Failed to initialize storage:', error);
                setError('Failed to initialize storage');
            }
        };

        initStorage();
    }, []);

    // Effect to initialize authentication state
    useEffect(() => {
        const initAuth = async () => {
            if (!storage) return;

            setIsLoading(true);
            try {
                // Try to load tokens from storage
                const accessToken = await storage.getItem(keys.accessToken);
                const refreshToken = await storage.getItem(keys.refreshToken);
                const storedUser = await storage.getItem(keys.user);

                if (accessToken) {
                    // Set tokens in OxyServices
                    if (refreshToken) {
                        oxyServices.setTokens(accessToken, refreshToken);
                    } else {
                        // Use setTokens with the same token if setToken is not available
                        oxyServices.setTokens(accessToken, accessToken);
                    }

                    // Validate the tokens
                    const isValid = await oxyServices.validate();

                    if (isValid && storedUser) {
                        // Set user state
                        const parsedUser = JSON.parse(storedUser);
                        setUser(parsedUser);

                        // Notify about auth state change
                        if (onAuthStateChange) {
                            onAuthStateChange(parsedUser);
                        }
                    } else {
                        // Tokens are invalid, clear everything
                        await clearStorage();
                        oxyServices.clearTokens();
                    }
                }
            } catch (err) {
                console.error('Auth initialization error:', err);
                await clearStorage();
                oxyServices.clearTokens();
            } finally {
                setIsLoading(false);
            }
        };

        if (storage) {
            initAuth();
        }
    }, [storage, oxyServices, keys.accessToken, keys.refreshToken, keys.user, onAuthStateChange]);

    // Helper to clear storage
    const clearStorage = async (): Promise<void> => {
        if (!storage) return;

        try {
            await storage.removeItem(keys.accessToken);
            await storage.removeItem(keys.refreshToken);
            await storage.removeItem(keys.user);
        } catch (err) {
            console.error('Clear storage error:', err);
        }
    };

    // Utility function to handle different token response formats
    const storeTokens = async (response: any) => {
        // Store token and user data
        if (response.accessToken) {
            await storage?.setItem(keys.accessToken, response.accessToken);
            if (response.refreshToken) {
                await storage?.setItem(keys.refreshToken, response.refreshToken);
            }
        } else if (response.token) {
            // Handle legacy API response
            await storage?.setItem(keys.accessToken, response.token);
        }
        await storage?.setItem(keys.user, JSON.stringify(response.user));
    };

    // Login method
    const login = async (username: string, password: string): Promise<User> => {
        if (!storage) throw new Error('Storage not initialized');

        setIsLoading(true);
        setError(null);

        try {
            const response = await oxyServices.login(username, password);
            setUser(response.user);

            // Store tokens
            await storeTokens(response);

            // Notify about auth state change
            if (onAuthStateChange) {
                onAuthStateChange(response.user);
            }

            return response.user;
        } catch (err: any) {
            setError(err.message || 'Login failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    // Logout method
    const logout = async (): Promise<void> => {
        if (!storage) throw new Error('Storage not initialized');

        setIsLoading(true);
        setError(null);

        try {
            await oxyServices.logout();
            await clearStorage();
            setUser(null);

            // Notify about auth state change
            if (onAuthStateChange) {
                onAuthStateChange(null);
            }
        } catch (err: any) {
            setError(err.message || 'Logout failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    // Sign up method
    const signUp = async (username: string, email: string, password: string): Promise<User> => {
        if (!storage) throw new Error('Storage not initialized');

        setIsLoading(true);
        setError(null);

        try {
            const response = await oxyServices.signUp(username, email, password);
            setUser(response.user);

            // Store tokens
            await storeTokens(response);

            // Notify about auth state change
            if (onAuthStateChange) {
                onAuthStateChange(response.user);
            }

            return response.user;
        } catch (err: any) {
            setError(err.message || 'Sign up failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    // Methods to control the bottom sheet
    const showBottomSheet = useCallback((screen?: string) => {
        if (bottomSheetRef?.current) {
            // Expand the bottom sheet
            bottomSheetRef.current.expand();

            // If a screen is specified, navigate to it
            if (screen && bottomSheetRef.current._navigateToScreen) {
                setTimeout(() => {
                    bottomSheetRef.current._navigateToScreen(screen);
                }, 100); // Small delay to ensure the sheet is expanded first
            }
        }
    }, [bottomSheetRef]);

    const hideBottomSheet = useCallback(() => {
        if (bottomSheetRef?.current) {
            bottomSheetRef.current.close();
        }
    }, [bottomSheetRef]);

    // Build context value
    const contextValue: OxyContextState = {
        user,
        isAuthenticated: !!user,
        isLoading,
        error,
        login,
        logout,
        signUp,
        oxyServices,
        bottomSheetRef,
        showBottomSheet,
        hideBottomSheet,
    };

    return (
        <OxyContext.Provider value={contextValue}>
            {children}
        </OxyContext.Provider>
    );
};

// Hook to use the context
export const useOxy = () => {
    const context = useContext(OxyContext);
    if (!context) {
        throw new Error('useOxy must be used within an OxyContextProvider');
    }
    return context;
};
