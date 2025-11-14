import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
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
    avatarUrl?: string; // Cached avatar URL to prevent recalculation
}

const MAX_QUICK_ACCOUNTS = 3;

const getThemeMode = (theme: string | undefined): 'light' | 'dark' =>
    theme === 'dark' ? 'dark' : 'light';

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

    // Compute sessions to show - deduplicate by sessionId to prevent duplicates
    const sessionsToShow = useMemo(() => {
        const allSessions = sessions || [];
        const filtered = allSessions.filter(s => s.sessionId !== activeSessionId);
        const sessionsList = isAddAccountMode ? filtered : allSessions;

        // Deduplicate by sessionId - use Map to preserve last occurrence
        const seen = new Map<string, typeof sessionsList[0]>();
        for (const session of sessionsList) {
            seen.set(session.sessionId, session);
        }

        return Array.from(seen.values());
    }, [sessions, activeSessionId, isAddAccountMode]);

    // Create stable session IDs string for comparison
    const sessionsToShowIds = useMemo(
        () => sessionsToShow.map(s => s.sessionId).sort().join(','),
        [sessionsToShow]
    );

    // Load account profiles - with avatar URL caching and race condition protection
    useEffect(() => {
        // Skip if session IDs haven't changed or already loading
        if (previousSessionIdsRef.current === sessionsToShowIds || loadingRef.current) {
            return;
        }

        if (!sessionsToShow.length || !oxyServices) {
            setQuickAccounts([]);
            setLoadingAccounts(false);
            previousSessionIdsRef.current = sessionsToShowIds;
            return;
        }

        // Mark as loading immediately to prevent duplicate calls
        loadingRef.current = true;
        previousSessionIdsRef.current = sessionsToShowIds;

        let cancelled = false;
        const targetSessions = sessionsToShow.slice(0, MAX_QUICK_ACCOUNTS);

        // Deduplicate session IDs - use Set to ensure uniqueness
        const uniqueSessionIds = Array.from(new Set(targetSessions.map(s => s.sessionId)));

        if (uniqueSessionIds.length === 0) {
            setQuickAccounts([]);
            setLoadingAccounts(false);
            loadingRef.current = false;
            return;
        }

        // Don't show loading if we already have accounts (prevents flicker)
        setQuickAccounts(prev => {
            if (prev.length === 0) {
                setLoadingAccounts(true);
            }
            return prev;
        });

        const loadAccounts = async () => {
            try {
                const batchResults = await oxyServices.getUsersBySessions(uniqueSessionIds);

                if (cancelled) return;

                // Deduplicate by sessionId using Map and cache avatar URLs
                const accountMap = new Map<string, QuickAccount>();

                for (const { sessionId, user: userData } of batchResults) {
                    if (!userData || accountMap.has(sessionId)) continue;

                    const displayName = userData.name?.full ||
                        userData.name?.first ||
                        userData.username ||
                        'Account';

                    // Pre-calculate avatar URL to prevent recalculation on every render
                    const avatarUrl = userData.avatar
                        ? oxyServices.getFileDownloadUrl(userData.avatar, 'thumb')
                        : undefined;

                    accountMap.set(sessionId, {
                        sessionId,
                        username: userData.username || '',
                        displayName,
                        avatar: userData.avatar,
                        avatarUrl, // Cache the URL
                    });
                }

                if (cancelled) return;

                // Preserve order from targetSessions and merge with existing to keep avatar URLs
                // Deduplicate final result to prevent any duplicates
                setQuickAccounts(prev => {
                    const existingMap = new Map(prev.map(a => [a.sessionId, a]));
                    const seen = new Set<string>();
                    const orderedAccounts: QuickAccount[] = [];

                    for (const session of targetSessions) {
                        const sessionId = session.sessionId;
                        if (seen.has(sessionId)) continue; // Skip duplicates
                        seen.add(sessionId);

                        const newAccount = accountMap.get(sessionId);
                        if (!newAccount) {
                            // Keep existing account if available
                            const existing = existingMap.get(sessionId);
                            if (existing) {
                                orderedAccounts.push(existing);
                            }
                            continue;
                        }

                        // Preserve existing avatarUrl if account data hasn't changed
                        const existing = existingMap.get(sessionId);
                        if (existing && existing.avatar === newAccount.avatar && existing.avatarUrl) {
                            orderedAccounts.push({ ...newAccount, avatarUrl: existing.avatarUrl });
                        } else {
                            orderedAccounts.push(newAccount);
                        }
                    }

                    return orderedAccounts;
                });
            } catch (error) {
                if (__DEV__) {
                    console.error('Failed to load accounts:', error);
                }
                if (!cancelled) {
                    setQuickAccounts(prev => prev.length === 0 ? [] : prev);
                }
            } finally {
                if (!cancelled) {
                    setLoadingAccounts(false);
                    loadingRef.current = false;
                }
            }
        };

        void loadAccounts();

        return () => {
            cancelled = true;
            loadingRef.current = false;
        };
    }, [sessionsToShowIds, oxyServices]);

    // Instant account switching - fire and forget for speed
    const handleSwitchAccount = useCallback(
        async (sessionId: string) => {
            if (switchingSessionId || sessionId === activeSessionId) return;

            // Instant UI update - don't wait for anything
            setSwitchingSessionId(sessionId);

            // Optimistically update accounts list immediately
            setQuickAccounts(prev => {
                const accountToSwitch = prev.find(a => a.sessionId === sessionId);
                if (!accountToSwitch) return prev;

                // Move switched account to top instantly
                const filtered = prev.filter(a => a.sessionId !== sessionId);
                return [accountToSwitch, ...filtered];
            });

            // Switch in background - don't block UI
            switchSession(sessionId).catch((error) => {
                if (__DEV__) {
                    console.error('Failed to switch account:', error);
                }
                // Revert on error
                setQuickAccounts(prev => {
                    const accountToSwitch = prev.find(a => a.sessionId === sessionId);
                    if (!accountToSwitch) return prev;
                    const filtered = prev.filter(a => a.sessionId !== sessionId);
                    return [...filtered, accountToSwitch];
                });
                toast.error(
                    t('signin.actions.switchAccountFailed') || 'Unable to switch accounts. Please try again.'
                );
            }).finally(() => {
                setSwitchingSessionId(null);
            });
        },
        [switchSession, switchingSessionId, activeSessionId, t]
    );

    // Memoize current user avatar URL to prevent recalculation
    const currentUserAvatarUrl = useMemo(() => {
        if (!isAddAccountMode || !user?.avatar || !oxyServices) return undefined;
        return oxyServices.getFileDownloadUrl(user.avatar, 'thumb');
    }, [isAddAccountMode, user?.avatar, oxyServices]);

    // Accounts for avatar display - deduplicated with cached URLs
    const accountsForAvatars = useMemo(() => {
        const seen = new Set<string>();
        const accounts: Array<QuickAccount & { isCurrent?: boolean; avatarUrl?: string }> = [];

        // Add current user if in add account mode
        if (isAddAccountMode && user && activeSessionId) {
            accounts.push({
                sessionId: activeSessionId,
                displayName: user.name?.full || user.username || 'Account',
                username: user.username || '',
                avatar: user.avatar,
                avatarUrl: currentUserAvatarUrl, // Use memoized URL
                isCurrent: true,
            });
            seen.add(activeSessionId);
        }

        // Add quick accounts (excluding duplicates) - already have cached avatarUrl
        for (const account of quickAccounts) {
            if (!seen.has(account.sessionId)) {
                accounts.push({
                    ...account,
                    isCurrent: account.sessionId === activeSessionId,
                });
                seen.add(account.sessionId);
            }
        }

        return accounts;
    }, [isAddAccountMode, user, quickAccounts, activeSessionId, currentUserAvatarUrl]);

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
                                    {accountsForAvatars.slice(0, 5).map((account, index) => (
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
                                                uri={account.avatarUrl}
                                            />
                                        </View>
                                    ))}
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
                                                    uri={currentUserAvatarUrl}
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
                                                            uri={account.avatarUrl}
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
