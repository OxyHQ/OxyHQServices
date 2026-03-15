/**
 * Shared account types and pure helper functions.
 * Used by both @oxyhq/services (React Native) and @oxyhq/auth (Web) account stores.
 */

export interface QuickAccount {
    sessionId: string;
    userId?: string;
    username: string;
    displayName: string;
    avatar?: string;
    avatarUrl?: string;
}

/**
 * Build an ordered array of QuickAccounts from a map and order list.
 */
export const buildAccountsArray = (
    accounts: Record<string, QuickAccount>,
    order: string[]
): QuickAccount[] => {
    const result: QuickAccount[] = [];
    for (const id of order) {
        const account = accounts[id];
        if (account) result.push(account);
    }
    return result;
};

/**
 * Create a QuickAccount from user data returned by the API.
 *
 * @param sessionId - Session identifier
 * @param userData - Raw user object from the API
 * @param existingAccount - Previously cached account (to preserve avatarUrl if unchanged)
 * @param getFileDownloadUrl - Function to generate avatar download URL from file ID
 */
export const createQuickAccount = (
    sessionId: string,
    userData: {
        name?: { full?: string; first?: string };
        username?: string;
        id?: string;
        _id?: { toString(): string } | string;
        avatar?: string;
    },
    existingAccount?: QuickAccount,
    getFileDownloadUrl?: (fileId: string, variant: string) => string
): QuickAccount => {
    const displayName = userData.name?.full || userData.name?.first || userData.username || 'Account';
    const userId = userData.id || (typeof userData._id === 'string' ? userData._id : userData._id?.toString());

    // Preserve existing avatarUrl if avatar hasn't changed (prevents image reload)
    let avatarUrl: string | undefined;
    if (existingAccount && existingAccount.avatar === userData.avatar && existingAccount.avatarUrl) {
        avatarUrl = existingAccount.avatarUrl;
    } else if (userData.avatar && getFileDownloadUrl) {
        avatarUrl = getFileDownloadUrl(userData.avatar, 'thumb');
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
