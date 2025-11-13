import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useDebounce } from '../../../utils/hookUtils';
import {
    View,
    Text,
    StyleSheet,
    ActivityIndicator,
    TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import { useI18n } from '../../hooks/useI18n';
import { stepStyles } from '../../styles/spacing';
import Avatar from '../../components/Avatar';
import { useOxy } from '../../context/OxyContext';
import { toast } from '../../../lib/sonner';
import { TTLCache, registerCacheForCleanup } from '../../../utils/cache';

interface SignInUsernameStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: RouteName, props?: Record<string, any>) => void;

    // Step navigation
    nextStep: () => void;
    prevStep: () => void;
    currentStep: number;
    totalSteps: number;

    // Data management
    stepData?: any;
    updateStepData: (data: any) => void;
    allStepData: any[];

    // Form state
    username: string;
    setUsername: (username: string) => void;
    errorMessage: string;
    setErrorMessage: (message: string) => void;
    validationStatus: 'idle' | 'validating' | 'valid' | 'invalid';
    userProfile: any;
    isValidating: boolean;

    // Add account mode
    isAddAccountMode?: boolean;
    user?: any;

    // Validation function
    validateUsername: (username: string) => Promise<boolean>;
}

interface QuickAccount {
    sessionId: string;
    username: string;
    displayName: string;
    avatar?: string;
}

const MAX_QUICK_ACCOUNTS = 3;

const getThemeMode = (theme: string | undefined): 'light' | 'dark' =>
    theme === 'dark' ? 'dark' : 'light';

/**
 * Profile cache to avoid re-fetching user profiles on every account switch
 * Uses centralized TTLCache for consistent caching behavior
 */
const profileCache = new TTLCache<QuickAccount>(5 * 60 * 1000); // 5 minutes cache
registerCacheForCleanup(profileCache); // Register for automatic cleanup

/**
 * Batch fetch profiles using optimized backend endpoint
 * Only fetches profiles that aren't cached or are expired
 */
async function batchGetProfiles(
    sessionIds: string[],
    oxyServices: any
): Promise<Map<string, QuickAccount>> {
    const results = new Map<string, QuickAccount>();
    const toFetch: string[] = [];

    // Check cache first
    for (const sessionId of sessionIds) {
        const cached = profileCache.get(sessionId);
        if (cached) {
            results.set(sessionId, cached);
        } else {
            toFetch.push(sessionId);
        }
    }

    // Batch fetch only uncached profiles
    if (toFetch.length > 0 && oxyServices?.getUsersBySessions) {
        try {
            const batchResults = await oxyServices.getUsersBySessions(toFetch);

            for (const { sessionId, user } of batchResults) {
                if (user) {
                    const displayName =
                        user?.name?.full ||
                        user?.name?.first ||
                        user?.username ||
                        'Account';

                    const quickAccount: QuickAccount = {
                        sessionId,
                        username: user.username || '',
                        displayName,
                        avatar: user?.avatar,
                    };

                    profileCache.set(sessionId, quickAccount);
                    results.set(sessionId, quickAccount);
                }
            }
        } catch (error) {
            if (__DEV__) {
                console.error('Failed to batch load profiles:', error);
            }
        }
    }

    return results;
};

const SignInUsernameStep: React.FC<SignInUsernameStepProps> = ({
    colors,
    styles,
    theme,
    navigate,
    nextStep,
    username,
    setUsername,
    errorMessage,
    setErrorMessage,
    validationStatus,
    userProfile,
    isValidating,
    isAddAccountMode,
    user,
    validateUsername,
}) => {
    const inputRef = useRef<any>(null);
    const { t } = useI18n();
    const { sessions, activeSessionId, switchSession, oxyServices } = useOxy();
    const baseStyles = stepStyles;
    const themeMode = getThemeMode(theme);
    const [quickAccounts, setQuickAccounts] = useState<QuickAccount[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(false);
    const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
    const [showAccounts, setShowAccounts] = useState(false);

    const previousSessionIdsRef = useRef<string>('');
    const loadingRef = useRef(false);

    // Debounce sessions to prevent showing intermediate states during rapid updates
    const stableSessions = useDebounce(sessions || [], 200);

    // Sessions to display - filtered and computed inline
    const sessionsToShow = useMemo(
        () => {
            const filtered = stableSessions.filter(s => s.sessionId !== activeSessionId);
            return isAddAccountMode ? filtered : stableSessions;
        },
        [stableSessions, activeSessionId, isAddAccountMode]
    );

    const sessionsToShowIds = useMemo(
        () => sessionsToShow.map(s => s.sessionId).sort().join(','),
        [sessionsToShow]
    );

    // Production-ready: Optimized to prevent unnecessary reloads and duplicate accounts
    useEffect(() => {
        // Skip if already loading or session IDs haven't changed
        if (loadingRef.current || previousSessionIdsRef.current === sessionsToShowIds) {
            return;
        }

        if (!sessionsToShow.length || !oxyServices) {
            setQuickAccounts([]);
            setLoadingAccounts(false);
            previousSessionIdsRef.current = sessionsToShowIds;
            return;
        }

        let cancelled = false;
        loadingRef.current = true;

        const loadQuickAccounts = async () => {
            // Don't show loading state if we already have accounts (prevents flicker)
            const hasExistingAccounts = quickAccounts.length > 0;
            if (!hasExistingAccounts) {
                setLoadingAccounts(true);
            }

            const targetSessions = sessionsToShow.slice(0, MAX_QUICK_ACCOUNTS);
            const sessionIds = targetSessions.map(s => s.sessionId);

            try {
                const profilesMap = await batchGetProfiles(sessionIds, oxyServices);

                if (!cancelled) {
                    // Deduplicate by sessionId
                    const seen = new Set<string>();
                    const validAccounts = targetSessions
                        .map(session => profilesMap.get(session.sessionId))
                        .filter((account): account is QuickAccount => {
                            if (!account || seen.has(account.sessionId)) return false;
                            seen.add(account.sessionId);
                            return true;
                        });

                    setQuickAccounts(validAccounts);
                    previousSessionIdsRef.current = sessionsToShowIds;
                }
            } catch (error) {
                if (__DEV__) {
                    console.error('Failed to load quick accounts:', error);
                }
                // Don't clear existing accounts on error - keep what we have
                if (!cancelled && !hasExistingAccounts) {
                    setQuickAccounts([]);
                }
            } finally {
                if (!cancelled) {
                    setLoadingAccounts(false);
                    loadingRef.current = false;
                }
            }
        };

        void loadQuickAccounts();

        return () => {
            cancelled = true;
            loadingRef.current = false;
        };
    }, [sessionsToShowIds, oxyServices, sessionsToShow.length]);

    const handleSwitchAccount = useCallback(
        async (sessionId: string) => {
            if (switchingSessionId) return;

            setSwitchingSessionId(sessionId);
            try {
                // Clear cache for the switched session to force fresh data
                profileCache.delete(sessionId);

                await switchSession(sessionId);

                // Don't reload accounts immediately - let the sessions update naturally
                // This prevents redundant API calls. The accounts will update when sessions change.
                // The switchSession call already triggers session refresh in the background.

                toast.success(
                    t('signin.status.accountSwitched', {
                        name: t('signin.actions.openAccountSwitcher'),
                    }) || 'Account switched'
                );
            } catch (error) {
                if (__DEV__) {
                    console.error('Failed to switch account:', error);
                }
                toast.error(
                    t('signin.actions.switchAccountFailed') || 'Unable to switch accounts. Please try again.'
                );
            } finally {
                setSwitchingSessionId(null);
            }
        },
        [switchSession, t, switchingSessionId]
    );

    // Accounts for avatar display - combines current user and quick accounts
    const accountsForAvatars = useMemo(() => {
        const seen = new Set<string>();
        const accounts = [
            ...(isAddAccountMode && user && activeSessionId ? [{
                sessionId: activeSessionId,
                displayName: user.name?.full || user.username || 'Account',
                username: user.username,
                avatar: user.avatar,
                isCurrent: true,
            }] : []),
            ...quickAccounts.map(account => ({
                sessionId: account.sessionId,
                displayName: account.displayName,
                username: account.username,
                avatar: account.avatar,
                isCurrent: account.sessionId === activeSessionId,
            }))
        ];
        return accounts.filter(account => {
            if (seen.has(account.sessionId)) return false;
            seen.add(account.sessionId);
            return true;
        });
    }, [isAddAccountMode, user, quickAccounts, activeSessionId]);

    const handleUsernameChange = useCallback((text: string) => {
        const filteredText = text.replace(/[^a-zA-Z0-9]/g, '');
        setUsername(filteredText);
        if (errorMessage) setErrorMessage('');
    }, [setUsername, setErrorMessage, errorMessage]);

    const handleContinue = useCallback(async () => {
        const trimmedUsername = username?.trim() || '';

        if (!trimmedUsername) {
            setErrorMessage(t('signin.username.required') || 'Please enter your username.');
            setTimeout(() => inputRef.current?.focus(), 0);
            return;
        }

        if (trimmedUsername.length < 3) {
            setErrorMessage(t('signin.username.minLength') || 'Username must be at least 3 characters.');
            return;
        }

        try {
            const isValid = await validateUsername(trimmedUsername);
            if (isValid) {
                nextStep();
            }
        } catch (error) {
            if (__DEV__) console.error('Error during username validation:', error);
            setErrorMessage('Unable to validate username. Please try again.');
        }
    }, [username, validateUsername, nextStep, setErrorMessage, t]);

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, { alignItems: 'flex-start', position: 'relative' }]}>
                <HighFive width={100} height={100} />
                <TouchableOpacity
                    style={[stylesheet.languageButton, { backgroundColor: colors.inputBackground }]}
                    onPress={() => navigate('LanguageSelector')}
                    activeOpacity={0.7}
                >
                    <Ionicons name="globe-outline" size={20} color={colors.primary} />
                </TouchableOpacity>
            </View>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>
                    {t('signin.title')}
                </Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>
                    {t('signin.subtitle')}
                </Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                <TextField
                    ref={inputRef}
                    label={t('common.labels.username')}
                    leading={<Ionicons name="person-outline" size={24} color={colors.secondaryText} />}
                    value={username}
                    onChangeText={handleUsernameChange}
                    formatValue={(text) => text.replace(/[^a-zA-Z0-9]/g, '')}
                    maxLength={30}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="username-input"
                    variant="filled"
                    error={validationStatus === 'invalid' ? errorMessage : undefined}
                    loading={validationStatus === 'validating'}
                    success={validationStatus === 'valid'}
                    helperText={t('signin.username.helper') || '3-30 characters, letters and numbers only'}
                    onSubmitEditing={() => handleContinue()}
                    autoFocus
                    accessibilityLabel={t('common.labels.username')}
                    accessibilityHint={t('signin.username.helper') || 'Enter your username, 3-30 characters, letters and numbers only'}
                    style={{ marginBottom: 0 }}
                />
            </View>

            {((isAddAccountMode && user) || sessionsToShow.length > 0) && (
                <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.dividerContainer]}>
                    <View style={[stylesheet.dividerLine, { backgroundColor: colors.border }]} />
                    <Text style={[stylesheet.dividerText, { color: colors.secondaryText }]}>
                        {t('signin.or') || 'or'}
                    </Text>
                    <View style={[stylesheet.dividerLine, { backgroundColor: colors.border }]} />
                </View>
            )}

            {(isAddAccountMode && user) || sessionsToShow.length > 0 ? (
                <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                    <TouchableOpacity
                        style={[
                            stylesheet.toggleButton,
                            {
                                backgroundColor: colors.inputBackground,
                            },
                        ]}
                        onPress={() => setShowAccounts(!showAccounts)}
                        activeOpacity={0.7}
                    >
                        <View style={stylesheet.toggleButtonContent}>
                            <Ionicons
                                name={showAccounts ? 'chevron-down' : 'chevron-forward'}
                                size={18}
                                color={colors.primary}
                            />
                            <Text style={[stylesheet.toggleButtonText, { color: colors.text }]}>
                                {t('signin.alreadySignedInWith') || 'Already signed in with'}
                            </Text>
                            {accountsForAvatars.length > 0 && (
                                <View style={stylesheet.avatarsContainer}>
                                    {accountsForAvatars.slice(0, 5).map((account, index) => {
                                        // Memoize avatar URL to prevent unnecessary re-renders
                                        const avatarUri = account.avatar && oxyServices
                                            ? oxyServices.getFileDownloadUrl(account.avatar, 'thumb')
                                            : undefined;

                                        return (
                                            <View
                                                key={`avatar-${account.sessionId}`}
                                                style={[
                                                    stylesheet.avatarWrapper,
                                                    account.isCurrent && stylesheet.currentAvatarWrapper,
                                                    index > 0 && { marginLeft: -12 },
                                                    { zIndex: Math.min(accountsForAvatars.length, 5) - index },
                                                    { borderColor: colors.inputBackground || colors.background || '#FFFFFF' },
                                                ]}
                                            >
                                                <Avatar
                                                    name={account.displayName}
                                                    size={28}
                                                    theme={themeMode}
                                                    backgroundColor={colors.primary}
                                                    uri={avatarUri}
                                                />
                                            </View>
                                        );
                                    })}
                                </View>
                            )}
                            {!showAccounts && (quickAccounts.length > 0 || sessionsToShow.length > 0) && accountsForAvatars.length === 0 && (
                                <View style={[stylesheet.accountCountBadge, { backgroundColor: `${colors.primary}15` }]}>
                                    <Text style={[stylesheet.accountCountText, { color: colors.primary }]}>
                                        {sessionsToShow.length + (isAddAccountMode && user ? 1 : 0)}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>

                    {showAccounts && (
                        <View style={stylesheet.accountsList}>
                            {loadingAccounts && quickAccounts.length === 0 && !isAddAccountMode ? (
                                <View style={stylesheet.accountItem}>
                                    <ActivityIndicator color={colors.primary} size="small" />
                                </View>
                            ) : (
                                <>
                                    {isAddAccountMode && user && (
                                        <View
                                            style={[
                                                stylesheet.accountItem,
                                                {
                                                    backgroundColor: colors.inputBackground,
                                                },
                                            ]}
                                        >
                                            <View style={[stylesheet.accountItemAvatarWrapper, { borderColor: colors.inputBackground || colors.background || '#FFFFFF' }]}>
                                                <Avatar
                                                    name={user.name?.full || user.username}
                                                    size={36}
                                                    theme={themeMode}
                                                    backgroundColor={colors.primary}
                                                    uri={user.avatar && oxyServices ? oxyServices.getFileDownloadUrl(user.avatar, 'thumb') : undefined}
                                                />
                                            </View>
                                            <View style={stylesheet.accountItemText}>
                                                <Text
                                                    style={[stylesheet.accountItemName, { color: colors.text }]}
                                                    numberOfLines={1}
                                                >
                                                    {user.name?.full || user.username}
                                                </Text>
                                                {user.username && (
                                                    <Text
                                                        style={[
                                                            stylesheet.accountItemUsername,
                                                            { color: colors.secondaryText },
                                                        ]}
                                                        numberOfLines={1}
                                                    >
                                                        @{user.username}
                                                    </Text>
                                                )}
                                            </View>
                                            <View style={[stylesheet.currentAccountBadgeContainer, { backgroundColor: `${colors.primary}15` }]}>
                                                <Text style={[stylesheet.currentAccountBadge, { color: colors.primary }]}>
                                                    {t('signin.currentAccount') || 'Current'}
                                                </Text>
                                            </View>
                                        </View>
                                    )}
                                    {quickAccounts.map((account) => (
                                        <TouchableOpacity
                                            key={`account-${account.sessionId}`}
                                            style={[
                                                stylesheet.accountItem,
                                                {
                                                    backgroundColor: colors.inputBackground,
                                                },
                                                switchingSessionId === account.sessionId && stylesheet.accountItemLoading,
                                            ]}
                                            onPress={() => handleSwitchAccount(account.sessionId)}
                                            disabled={switchingSessionId === account.sessionId}
                                            activeOpacity={0.7}
                                        >
                                            {switchingSessionId === account.sessionId ? (
                                                <ActivityIndicator color={colors.primary} size="small" />
                                            ) : (
                                                <>
                                                    <View style={[stylesheet.accountItemAvatarWrapper, { borderColor: colors.inputBackground || colors.background || '#FFFFFF' }]}>
                                                        <Avatar
                                                            name={account.displayName}
                                                            size={36}
                                                            theme={themeMode}
                                                            backgroundColor={colors.primary}
                                                            uri={account.avatar && oxyServices ? oxyServices.getFileDownloadUrl(account.avatar, 'thumb') : undefined}
                                                        />
                                                    </View>
                                                    <View style={stylesheet.accountItemText}>
                                                        <Text
                                                            style={[stylesheet.accountItemName, { color: colors.text }]}
                                                            numberOfLines={1}
                                                        >
                                                            {account.displayName}
                                                        </Text>
                                                        {account.username && (
                                                            <Text
                                                                style={[
                                                                    stylesheet.accountItemUsername,
                                                                    { color: colors.secondaryText },
                                                                ]}
                                                                numberOfLines={1}
                                                            >
                                                                @{account.username}
                                                            </Text>
                                                        )}
                                                    </View>
                                                </>
                                            )}
                                        </TouchableOpacity>
                                    ))}
                                    {sessionsToShow.length > MAX_QUICK_ACCOUNTS && (
                                        <TouchableOpacity
                                            style={[
                                                stylesheet.accountItem,
                                                stylesheet.viewAllItem,
                                                {
                                                    backgroundColor: colors.inputBackground,
                                                },
                                            ]}
                                            onPress={() => navigate('AccountSwitcher')}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
                                            <Text style={[stylesheet.viewAllText, { color: colors.primary }]}>
                                                {t('signin.viewAllAccounts', {
                                                    count: sessionsToShow.length - MAX_QUICK_ACCOUNTS,
                                                }) || `View ${sessionsToShow.length - MAX_QUICK_ACCOUNTS} more`}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </>
                            )}
                        </View>
                    )}
                </View>
            ) : null}

            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.buttonContainer]}>
                <GroupedPillButtons
                    buttons={[
                        {
                            text: t('common.links.signUp'),
                            onPress: () => navigate('SignUp'),
                            icon: 'person-add',
                            variant: 'transparent',
                        },
                        {
                            text: t('common.actions.continue'),
                            onPress: handleContinue,
                            icon: 'arrow-forward',
                            variant: 'primary',
                            loading: isValidating,
                            disabled: !username || username.trim().length < 3 || isValidating,
                            testID: 'username-next-button',
                        },
                    ]}
                    colors={colors}
                />
            </View>
        </>
    );
};

export default SignInUsernameStep;

const stylesheet = StyleSheet.create({
    toggleButton: {
        borderRadius: 24,
        borderWidth: 0,
    },
    toggleButtonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 48,
        gap: 10,
    },
    toggleButtonText: {
        fontSize: 14,
        fontWeight: '500',
    },
    accountCountBadge: {
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 16,
        minWidth: 22,
        alignItems: 'center',
    },
    accountCountText: {
        fontSize: 11,
        fontWeight: '600',
    },
    accountsList: {
        gap: 6,
        marginTop: 6,
    },
    accountItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 24,
        borderWidth: 0,
        gap: 12,
        minHeight: 56,
    },
    accountItemLoading: {
        justifyContent: 'center',
        paddingHorizontal: 16,
    },
    accountItemText: {
        flex: 1,
    },
    accountItemName: {
        fontSize: 15,
        fontWeight: '500',
        marginBottom: 2,
    },
    accountItemUsername: {
        fontSize: 12,
    },
    viewAllItem: {
        justifyContent: 'center',
        paddingVertical: 10,
    },
    viewAllText: {
        fontSize: 14,
        fontWeight: '500',
        marginLeft: 4,
    },
    currentAccountBadgeContainer: {
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 16,
    },
    currentAccountBadge: {
        fontSize: 10,
        fontWeight: '600',
        letterSpacing: 0.3,
    },
    dividerContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginVertical: 8,
    },
    dividerLine: {
        flex: 1,
        height: 1,
    },
    dividerText: {
        fontSize: 14,
        fontWeight: '500',
        paddingHorizontal: 16,
        textTransform: 'lowercase',
    },
    avatarsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 'auto',
    },
    avatarWrapper: {
        position: 'relative',
        borderRadius: 20,
        borderWidth: 3,
    },
    currentAvatarWrapper: {
        borderWidth: 3,
    },
    accountItemAvatarWrapper: {
        borderRadius: 20,
        borderWidth: 3,
    },
    languageButton: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
