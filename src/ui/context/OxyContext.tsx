import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { OxyServices } from '../../core';
import { User, LoginResponse } from '../../models/interfaces';

// Define authenticated user with tokens
export interface AuthenticatedUser extends User {
    accessToken: string;
    refreshToken?: string;
    sessionId?: string;
}

// Define the context shape
export interface OxyContextState {
    // Multi-user authentication state
    user: User | null; // Current active user
    users: AuthenticatedUser[]; // All authenticated users
    isAuthenticated: boolean;
    isLoading: boolean;
    error: string | null;

    // Auth methods
    login: (username: string, password: string) => Promise<User>;
    logout: (userId?: string) => Promise<void>; // Optional userId for multi-user logout
    logoutAll: () => Promise<void>; // Logout all users
    signUp: (username: string, email: string, password: string) => Promise<User>;

    // Multi-user methods
    switchUser: (userId: string) => Promise<void>;
    removeUser: (userId: string) => Promise<void>;
    getUserSessions: (userId?: string) => Promise<any[]>; // Get sessions for user
    logoutSession: (sessionId: string, userId?: string) => Promise<void>; // Logout specific session

    // Access to services
    oxyServices: OxyServices;
    bottomSheetRef?: React.RefObject<any>;

    // Methods to directly control the bottom sheet
    showBottomSheet?: (screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => void;
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
    users: `${prefix}_users`, // Array of authenticated users with tokens
    activeUserId: `${prefix}_active_user_id`, // ID of currently active user
    // Legacy keys for migration
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
    const [users, setUsers] = useState<AuthenticatedUser[]>([]);
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
                // Check for multi-user data first
                const usersData = await storage.getItem(keys.users);
                const activeUserId = await storage.getItem(keys.activeUserId);

                console.log('InitAuth - usersData:', usersData);
                console.log('InitAuth - activeUserId:', activeUserId);

                if (usersData) {
                    // Multi-user setup exists
                    const parsedUsers: AuthenticatedUser[] = JSON.parse(usersData);
                    console.log('InitAuth - parsedUsers:', parsedUsers);
                    setUsers(parsedUsers);

                    if (activeUserId && parsedUsers.length > 0) {
                        const activeUser = parsedUsers.find(u => u.id === activeUserId);
                        console.log('InitAuth - activeUser found:', activeUser);
                        if (activeUser) {
                            setUser(activeUser);
                            oxyServices.setTokens(activeUser.accessToken, activeUser.refreshToken || activeUser.accessToken);
                            
                            // Validate the tokens
                            const isValid = await oxyServices.validate();
                            console.log('InitAuth - token validation result:', isValid);
                            if (!isValid) {
                                // Remove invalid user during initialization
                                console.log('InitAuth - removing invalid user due to failed validation');
                                const filteredUsers = parsedUsers.filter(u => u.id !== activeUser.id);
                                setUsers(filteredUsers);
                                await saveUsersToStorage(filteredUsers);
                                
                                // If there are other users, switch to the first one
                                if (filteredUsers.length > 0) {
                                    const newActiveUser = filteredUsers[0];
                                    setUser(newActiveUser);
                                    await saveActiveUserId(newActiveUser.id);
                                    oxyServices.setTokens(newActiveUser.accessToken, newActiveUser.refreshToken || newActiveUser.accessToken);
                                    
                                    if (onAuthStateChange) {
                                        onAuthStateChange(newActiveUser);
                                    }
                                } else {
                                    // No valid users left
                                    setUser(null);
                                    await storage.removeItem(keys.activeUserId);
                                    oxyServices.clearTokens();
                                    
                                    if (onAuthStateChange) {
                                        onAuthStateChange(null);
                                    }
                                }
                            } else {
                                console.log('InitAuth - user validated successfully, setting auth state');
                                // Notify about auth state change
                                if (onAuthStateChange) {
                                    onAuthStateChange(activeUser);
                                }
                            }
                        }
                    }
                } else {
                    console.log('InitAuth - no users data, checking legacy auth');
                    // Check for legacy single-user data and migrate
                    await migrateLegacyAuth();
                }
            } catch (err) {
                console.error('Auth initialization error:', err);
                await clearAllStorage();
                oxyServices.clearTokens();
            } finally {
                setIsLoading(false);
            }
        };

        if (storage) {
            initAuth();
        }
    }, [storage, oxyServices, keys.users, keys.activeUserId, onAuthStateChange]);

    // Migrate legacy single-user authentication to multi-user
    const migrateLegacyAuth = async (): Promise<void> => {
        if (!storage) return;

        try {
            const accessToken = await storage.getItem(keys.accessToken);
            const refreshToken = await storage.getItem(keys.refreshToken);
            const storedUser = await storage.getItem(keys.user);

            if (accessToken && storedUser) {
                // Set tokens in OxyServices
                oxyServices.setTokens(accessToken, refreshToken || accessToken);

                // Validate the tokens
                const isValid = await oxyServices.validate();

                if (isValid) {
                    const parsedUser = JSON.parse(storedUser);
                    const authenticatedUser: AuthenticatedUser = {
                        ...parsedUser,
                        accessToken,
                        refreshToken: refreshToken || undefined,
                    };

                    // Store in new multi-user format
                    await storage.setItem(keys.users, JSON.stringify([authenticatedUser]));
                    await storage.setItem(keys.activeUserId, authenticatedUser.id);

                    // Set state
                    setUsers([authenticatedUser]);
                    setUser(authenticatedUser);

                    // Notify about auth state change
                    if (onAuthStateChange) {
                        onAuthStateChange(authenticatedUser);
                    }
                }

                // Clear legacy storage
                await storage.removeItem(keys.accessToken);
                await storage.removeItem(keys.refreshToken);
                await storage.removeItem(keys.user);
            }
        } catch (err) {
            console.error('Migration error:', err);
        }
    };

    // Helper to clear legacy storage
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

    // Helper to clear all storage (multi-user)
    const clearAllStorage = async (): Promise<void> => {
        if (!storage) return;

        try {
            await storage.removeItem(keys.users);
            await storage.removeItem(keys.activeUserId);
            // Also clear legacy keys
            await clearStorage();
        } catch (err) {
            console.error('Clear all storage error:', err);
        }
    };

    // Save users to storage
    const saveUsersToStorage = async (usersList: AuthenticatedUser[]): Promise<void> => {
        if (!storage) return;
        await storage.setItem(keys.users, JSON.stringify(usersList));
    };

    // Save active user ID to storage
    const saveActiveUserId = async (userId: string): Promise<void> => {
        if (!storage) return;
        await storage.setItem(keys.activeUserId, userId);
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

    // Login method (updated for multi-user)
    const login = async (username: string, password: string): Promise<User> => {
        if (!storage) throw new Error('Storage not initialized');

        setIsLoading(true);
        setError(null);

        try {
            const response = await oxyServices.login(username, password);
            const accessToken = response.accessToken || (response as any).token;
            
            if (!accessToken) {
                throw new Error('No access token received from login');
            }

            const newUser: AuthenticatedUser = {
                ...response.user,
                accessToken,
                refreshToken: response.refreshToken,
                // sessionId will be set by backend, but we don't get it in response yet
            };

            // Check if user already exists
            const existingUserIndex = users.findIndex(u => u.id === newUser.id);
            let updatedUsers: AuthenticatedUser[];

            if (existingUserIndex >= 0) {
                // Update existing user
                updatedUsers = [...users];
                updatedUsers[existingUserIndex] = newUser;
            } else {
                // Add new user
                updatedUsers = [...users, newUser];
            }

            // Update state
            setUsers(updatedUsers);
            setUser(newUser);

            // Save to storage
            await saveUsersToStorage(updatedUsers);
            await saveActiveUserId(newUser.id);

            // Notify about auth state change
            if (onAuthStateChange) {
                onAuthStateChange(newUser);
            }

            return newUser;
        } catch (err: any) {
            setError(err.message || 'Login failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    // Logout method (supports multi-user)
    const logout = async (userId?: string): Promise<void> => {
        if (!storage) throw new Error('Storage not initialized');

        setIsLoading(true);
        setError(null);

        try {
            const targetUserId = userId || user?.id;
            if (!targetUserId) return;

            const targetUser = users.find(u => u.id === targetUserId);
            if (targetUser) {
                // Set the target user's tokens to logout
                oxyServices.setTokens(targetUser.accessToken, targetUser.refreshToken || targetUser.accessToken);
                
                try {
                    await oxyServices.logout();
                } catch (logoutError) {
                    console.warn('Logout API call failed:', logoutError);
                }

                // Remove user from list
                const updatedUsers = users.filter(u => u.id !== targetUserId);
                setUsers(updatedUsers);

                // If logging out current user, switch to another user or clear
                if (targetUserId === user?.id) {
                    if (updatedUsers.length > 0) {
                        // Switch to first available user
                        const nextUser = updatedUsers[0];
                        setUser(nextUser);
                        oxyServices.setTokens(nextUser.accessToken, nextUser.refreshToken || nextUser.accessToken);
                        await saveActiveUserId(nextUser.id);
                        
                        if (onAuthStateChange) {
                            onAuthStateChange(nextUser);
                        }
                    } else {
                        // No users left
                        setUser(null);
                        oxyServices.clearTokens();
                        await storage.removeItem(keys.activeUserId);
                        
                        if (onAuthStateChange) {
                            onAuthStateChange(null);
                        }
                    }
                }

                // Save updated users list
                await saveUsersToStorage(updatedUsers);
            }
        } catch (err: any) {
            setError(err.message || 'Logout failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    // Logout all users
    const logoutAll = async (): Promise<void> => {
        if (!storage) throw new Error('Storage not initialized');

        setIsLoading(true);
        setError(null);

        try {
            // Logout each user
            for (const userItem of users) {
                try {
                    oxyServices.setTokens(userItem.accessToken, userItem.refreshToken || userItem.accessToken);
                    await oxyServices.logout();
                } catch (logoutError) {
                    console.warn(`Logout failed for user ${userItem.id}:`, logoutError);
                }
            }

            // Clear all state and storage
            setUsers([]);
            setUser(null);
            oxyServices.clearTokens();
            await clearAllStorage();

            // Notify about auth state change
            if (onAuthStateChange) {
                onAuthStateChange(null);
            }
        } catch (err: any) {
            setError(err.message || 'Logout all failed');
            throw err;
        } finally {
            setIsLoading(false);
        }
    };

    // Switch user
    const switchUser = async (userId: string): Promise<void> => {
        if (!storage) throw new Error('Storage not initialized');

        setError(null);

        try {
            const targetUser = users.find(u => u.id === userId);
            if (!targetUser) {
                throw new Error('User not found');
            }

            // Validate tokens before switching
            oxyServices.setTokens(targetUser.accessToken, targetUser.refreshToken || targetUser.accessToken);
            const isValid = await oxyServices.validate();

            if (!isValid) {
                // Remove invalid user
                await removeUser(userId);
                throw new Error('User session is invalid');
            }

            // Switch to the user
            setUser(targetUser);
            await saveActiveUserId(userId);

            // Notify about auth state change
            if (onAuthStateChange) {
                onAuthStateChange(targetUser);
            }
        } catch (err: any) {
            setError(err.message || 'Switch user failed');
            throw err;
        }
    };

    // Remove user
    const removeUser = async (userId: string): Promise<void> => {
        if (!storage) throw new Error('Storage not initialized');

        try {
            const updatedUsers = users.filter(u => u.id !== userId);
            setUsers(updatedUsers);

            // If removing current user, switch to another or clear
            if (userId === user?.id) {
                if (updatedUsers.length > 0) {
                    await switchUser(updatedUsers[0].id);
                } else {
                    setUser(null);
                    oxyServices.clearTokens();
                    await storage.removeItem(keys.activeUserId);
                    
                    if (onAuthStateChange) {
                        onAuthStateChange(null);
                    }
                }
            }

            // Save updated users list
            await saveUsersToStorage(updatedUsers);
        } catch (err: any) {
            setError(err.message || 'Remove user failed');
            throw err;
        }
    };

    // Get user sessions
    const getUserSessions = async (userId?: string): Promise<any[]> => {
        try {
            const targetUserId = userId || user?.id;
            if (!targetUserId) return [];

            const targetUser = users.find(u => u.id === targetUserId);
            if (!targetUser) return [];

            // Store current tokens to restore later
            const currentUser = user;
            const wasCurrentUser = targetUserId === user?.id;

            if (!wasCurrentUser) {
                // Temporarily switch to target user's tokens
                oxyServices.setTokens(targetUser.accessToken, targetUser.refreshToken || targetUser.accessToken);
            }

            try {
                // Use the new OxyServices method
                const sessions = await oxyServices.getUserSessions();
                return sessions;
            } finally {
                if (!wasCurrentUser && currentUser) {
                    // Restore original tokens
                    oxyServices.setTokens(currentUser.accessToken, currentUser.refreshToken || currentUser.accessToken);
                }
            }
        } catch (err: any) {
            console.error('Get user sessions failed:', err);
            return [];
        }
    };

    // Logout specific session
    const logoutSession = async (sessionId: string, userId?: string): Promise<void> => {
        try {
            const targetUserId = userId || user?.id;
            if (!targetUserId) return;

            const targetUser = users.find(u => u.id === targetUserId);
            if (!targetUser) return;

            // Store current tokens to restore later
            const currentUser = user;
            const wasCurrentUser = targetUserId === user?.id;

            if (!wasCurrentUser) {
                // Temporarily switch to target user's tokens
                oxyServices.setTokens(targetUser.accessToken, targetUser.refreshToken || targetUser.accessToken);
            }

            try {
                // Use the new OxyServices method
                await oxyServices.logoutSession(sessionId);
                
                // If this is the current user's session, remove them from local state
                if (wasCurrentUser && sessionId === targetUser.sessionId) {
                    await removeUser(targetUserId);
                }
            } finally {
                if (!wasCurrentUser && currentUser) {
                    // Restore original tokens
                    oxyServices.setTokens(currentUser.accessToken, currentUser.refreshToken || currentUser.accessToken);
                }
            }
        } catch (err: any) {
            console.error('Logout session failed:', err);
            throw err;
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
    const showBottomSheet = useCallback((screenOrConfig?: string | { screen: string; props?: Record<string, any> }) => {
        if (bottomSheetRef?.current) {
            // Expand the bottom sheet
            bottomSheetRef.current.expand();
            if (typeof screenOrConfig === 'string') {
                // If a screen is specified, navigate to it
                if (screenOrConfig && bottomSheetRef.current._navigateToScreen) {
                    setTimeout(() => {
                        bottomSheetRef.current._navigateToScreen(screenOrConfig);
                    }, 100);
                }
            } else if (screenOrConfig && typeof screenOrConfig === 'object' && screenOrConfig.screen) {
                // If an object is passed, navigate and pass props
                if (bottomSheetRef.current._navigateToScreen) {
                    setTimeout(() => {
                        bottomSheetRef.current._navigateToScreen(screenOrConfig.screen, screenOrConfig.props || {});
                    }, 100);
                }
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
        // Single user state (current active user)
        user,
        isAuthenticated: !!user,
        isLoading,
        error,
        
        // Multi-user state
        users,
        
        // Auth methods
        login,
        logout,
        logoutAll,
        signUp,
        
        // Multi-user methods
        switchUser,
        removeUser,
        getUserSessions,
        logoutSession,
        
        // OxyServices instance
        oxyServices,
        
        // Bottom sheet methods
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
