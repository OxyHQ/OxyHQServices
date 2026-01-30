import { create } from 'zustand';
import { shallow } from 'zustand/shallow';
import type { OxyServices } from '@oxyhq/core';

export interface QuickAccount {
    sessionId: string;
    userId?: string; // User ID for deduplication
    username: string;
    displayName: string;
    avatar?: string;
    avatarUrl?: string; // Cached avatar URL to prevent recalculation
}

interface AccountState {
    // Account data
    accounts: Record<string, QuickAccount>;
    accountOrder: string[]; // Maintain order for display
    accountsArray: QuickAccount[]; // Cached array to prevent infinite loops
    
    // Loading states
    loading: boolean;
    loadingSessionIds: Set<string>;
    
    // Error state
    error: string | null;
    
    // Actions
    setAccounts: (accounts: QuickAccount[]) => void;
    addAccount: (account: QuickAccount) => void;
    updateAccount: (sessionId: string, updates: Partial<QuickAccount>) => void;
    removeAccount: (sessionId: string) => void;
    moveAccountToTop: (sessionId: string) => void;
    
    // Loading actions
    setLoading: (loading: boolean) => void;
    setLoadingSession: (sessionId: string, loading: boolean) => void;
    
    // Error actions
    setError: (error: string | null) => void;
    
    // Load accounts from API
    loadAccounts: (sessionIds: string[], oxyServices: OxyServices, existingAccounts?: QuickAccount[], preserveOrder?: boolean) => Promise<void>;
    
    // Reset store
    reset: () => void;
}

const initialState = {
    accounts: {} as Record<string, QuickAccount>,
    accountOrder: [] as string[],
    accountsArray: [] as QuickAccount[],
    loading: false,
    loadingSessionIds: new Set<string>(),
    error: null,
};

// Helper: Build accounts array from accounts map and order
const buildAccountsArray = (accounts: Record<string, QuickAccount>, order: string[]): QuickAccount[] => {
    const result: QuickAccount[] = [];
    for (const id of order) {
        const account = accounts[id];
        if (account) result.push(account);
    }
    return result;
};

// Helper: Create QuickAccount from user data
const createQuickAccount = (sessionId: string, userData: any, existingAccount?: QuickAccount, oxyServices?: OxyServices): QuickAccount => {
    const displayName = userData.name?.full || userData.name?.first || userData.username || 'Account';
    const userId = userData.id || userData._id?.toString();
    
    // Preserve existing avatarUrl if avatar hasn't changed (prevents image reload)
    let avatarUrl: string | undefined;
    if (existingAccount && existingAccount.avatar === userData.avatar && existingAccount.avatarUrl) {
        avatarUrl = existingAccount.avatarUrl; // Reuse existing URL
    } else if (userData.avatar && oxyServices) {
        avatarUrl = oxyServices.getFileDownloadUrl(userData.avatar, 'thumb');
    }
    
    return {
        sessionId,
        userId,
        username: userData.username || '',
        displayName,
        avatar: userData.avatar,
        avatarUrl,
    };
};

export const useAccountStore = create<AccountState>((set, get) => ({
    ...initialState,
    
    setAccounts: (accounts) => set((state) => {
        const accountMap: Record<string, QuickAccount> = {};
        const order: string[] = [];
        const seenSessionIds = new Set<string>();
        
        for (const account of accounts) {
            if (seenSessionIds.has(account.sessionId)) continue;
            seenSessionIds.add(account.sessionId);
            accountMap[account.sessionId] = account;
            order.push(account.sessionId);
        }
        
        const accountsArray = buildAccountsArray(accountMap, order);
        const sameOrder = order.length === state.accountOrder.length && 
            order.every((id, i) => id === state.accountOrder[i]);
        const sameAccounts = sameOrder && 
            order.every(id => {
                const existing = state.accounts[id];
                const newAccount = accountMap[id];
                return existing && 
                    existing.sessionId === newAccount.sessionId &&
                    existing.userId === newAccount.userId &&
                    existing.avatar === newAccount.avatar &&
                    existing.avatarUrl === newAccount.avatarUrl;
            });
        
        if (sameAccounts) return {} as any;
        
        return { accounts: accountMap, accountOrder: order, accountsArray };
    }),
    
    addAccount: (account) => set((state) => {
        // Check if account with same sessionId exists
        if (state.accounts[account.sessionId]) {
            // Update existing
            const existing = state.accounts[account.sessionId];
            if (existing.avatar === account.avatar && existing.avatarUrl === account.avatarUrl) {
                return {} as any; // No change
            }
            const newAccounts = { ...state.accounts, [account.sessionId]: account };
            return {
                accounts: newAccounts,
                accountsArray: buildAccountsArray(newAccounts, state.accountOrder),
            };
        }
        
        const newAccounts = { ...state.accounts, [account.sessionId]: account };
        const newOrder = [account.sessionId, ...state.accountOrder];
        return {
            accounts: newAccounts,
            accountOrder: newOrder,
            accountsArray: buildAccountsArray(newAccounts, newOrder),
        };
    }),
    
    updateAccount: (sessionId, updates) => set((state) => {
        const existing = state.accounts[sessionId];
        if (!existing) return {} as any;
        
        const updated = { ...existing, ...updates };
        if (existing.avatar === updated.avatar && existing.avatarUrl === updated.avatarUrl) {
            return {} as any; // No change
        }
        
        const newAccounts = { ...state.accounts, [sessionId]: updated };
        return {
            accounts: newAccounts,
            accountsArray: buildAccountsArray(newAccounts, state.accountOrder),
        };
    }),
    
    removeAccount: (sessionId) => set((state) => {
        if (!state.accounts[sessionId]) return {} as any;
        
        const { [sessionId]: _removed, ...rest } = state.accounts;
        const newOrder = state.accountOrder.filter(id => id !== sessionId);
        
        return {
            accounts: rest,
            accountOrder: newOrder,
            accountsArray: buildAccountsArray(rest, newOrder),
        };
    }),
    
    moveAccountToTop: (sessionId) => set((state) => {
        if (!state.accounts[sessionId]) return {} as any;
        
        const filtered = state.accountOrder.filter(id => id !== sessionId);
        const newOrder = [sessionId, ...filtered];
        
        return {
            accountOrder: newOrder,
            accountsArray: buildAccountsArray(state.accounts, newOrder),
        };
    }),
    
    setLoading: (loading) => set({ loading }),
    
    setLoadingSession: (sessionId, loading) => set((state) => {
        const newSet = new Set(state.loadingSessionIds);
        if (loading) {
            newSet.add(sessionId);
        } else {
            newSet.delete(sessionId);
        }
        return { loadingSessionIds: newSet };
    }),
    
    setError: (error) => set({ error }),
    
    loadAccounts: async (sessionIds, oxyServices, existingAccounts = [], preserveOrder = true) => {
        const state = get();
        
        const uniqueSessionIds = Array.from(new Set(sessionIds));
        if (uniqueSessionIds.length === 0) {
            get().setAccounts([]);
            return;
        }
        
        // Try to get data from TanStack Query cache first
        try {
            // This will be called from a component, so we need to access queryClient differently
            // For now, we'll keep the API call but optimize it
            const existingMap = new Map(existingAccounts.map(a => [a.sessionId, a]));
            for (const account of Object.values(state.accounts)) {
                existingMap.set(account.sessionId, account);
            }
            
            const missingSessionIds = uniqueSessionIds.filter(id => !existingMap.has(id));
            
            if (missingSessionIds.length === 0) {
                const ordered = uniqueSessionIds
                    .map(id => existingMap.get(id))
                    .filter((acc): acc is QuickAccount => acc !== undefined);
                get().setAccounts(ordered);
                return;
            }
            
            if (state.loading) {
                return;
            }
            
            set({ loading: true, error: null });
            
            try {
                const batchResults = await oxyServices.getUsersBySessions(missingSessionIds);
                
                const accountMap = new Map<string, QuickAccount>();
                
                for (const { sessionId, user: userData } of batchResults) {
                    if (userData && !accountMap.has(sessionId)) {
                        const existing = existingMap.get(sessionId);
                        accountMap.set(sessionId, createQuickAccount(sessionId, userData, existing, oxyServices));
                    }
                }
                
                for (const [sessionId, account] of accountMap) {
                    existingMap.set(sessionId, account);
                }
                
                const orderToUse = preserveOrder ? uniqueSessionIds : [...uniqueSessionIds, ...state.accountOrder];
                const seen = new Set<string>();
                const ordered: QuickAccount[] = [];
                
                for (const sessionId of orderToUse) {
                    if (seen.has(sessionId)) continue;
                    seen.add(sessionId);
                    
                    const account = existingMap.get(sessionId);
                    if (account) ordered.push(account);
                }
                
                get().setAccounts(ordered);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Failed to load accounts';
                if (__DEV__) {
                    console.error('AccountStore: Failed to load accounts:', error);
                }
                set({ error: errorMessage });
            } finally {
                set({ loading: false });
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Failed to load accounts';
            if (__DEV__) {
                console.error('AccountStore: Failed to load accounts:', error);
            }
            set({ error: errorMessage, loading: false });
        }
    },
    
    reset: () => set(initialState),
}));

// Selectors for performance - return cached array to prevent infinite loops
export const useAccounts = (): QuickAccount[] => {
    return useAccountStore(state => state.accountsArray);
};

export const useAccountLoading = () => useAccountStore(s => s.loading);
export const useAccountError = () => useAccountStore(s => s.error);
export const useAccountLoadingSession = (sessionId: string) => 
    useAccountStore(s => s.loadingSessionIds.has(sessionId));

