import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import {
    View,
    Text,
    Platform,
    StyleSheet,
    type ViewStyle,
    type TextStyle,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';
import Avatar from '../../components/Avatar';
import { TouchableOpacity } from 'react-native';
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
    const webShadowReset = Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : null;
    const themeMode = getThemeMode(theme);
    const [quickAccounts, setQuickAccounts] = useState<QuickAccount[]>([]);
    const [loadingAccounts, setLoadingAccounts] = useState(false);
    const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
    const [showAccounts, setShowAccounts] = useState(false);

    const otherSessions = useMemo(
        () => (sessions ?? []).filter((session) => session.sessionId !== activeSessionId),
        [sessions, activeSessionId]
    );

    // Show accounts if we have any sessions (either in add account mode or just have saved sessions)
    const hasSessions = (sessions ?? []).length > 0;

    // Use other sessions if in add account mode, otherwise show all sessions
    const sessionsToShow = isAddAccountMode ? otherSessions : (sessions ?? []);

    // Debug logging
    if (__DEV__) {
        console.log('SignInUsernameStep - Debug:', {
            isAddAccountMode,
            hasSessions,
            sessionsCount: sessions?.length ?? 0,
            otherSessionsCount: otherSessions.length,
            sessionsToShowCount: sessionsToShow.length,
            activeSessionId,
            quickAccountsCount: quickAccounts.length,
            loadingAccounts,
        });
    }

    useEffect(() => {
        let cancelled = false;

        const loadQuickAccounts = async () => {
            // Show accounts if we have sessions and services available
            // In add account mode, show other sessions; otherwise show all sessions
            if (!hasSessions || !oxyServices) {
                if (!cancelled) {
                    setQuickAccounts([]);
                    setLoadingAccounts(false);
                }
                return;
            }

            // If in add account mode and no other sessions, don't show anything
            if (isAddAccountMode && sessionsToShow.length === 0) {
                if (!cancelled) {
                    setQuickAccounts([]);
                    setLoadingAccounts(false);
                }
                return;
            }

            // If not in add account mode and no sessions, don't show anything
            if (!isAddAccountMode && sessionsToShow.length === 0) {
                if (!cancelled) {
                    setQuickAccounts([]);
                    setLoadingAccounts(false);
                }
                return;
            }

            setLoadingAccounts(true);
            const targetSessions = sessionsToShow.slice(0, MAX_QUICK_ACCOUNTS);

            try {
                const results = await Promise.all(
                    targetSessions.map(async (session): Promise<QuickAccount | null> => {
                        try {
                            const profile = await oxyServices.getUserBySession(session.sessionId);
                            const displayName =
                                profile?.name?.full ||
                                profile?.name?.first ||
                                profile?.username ||
                                'Account';

                            return {
                                sessionId: session.sessionId,
                                username: profile?.username ?? 'account',
                                displayName,
                                avatar: profile?.avatar,
                            };
                        } catch (error) {
                            if (__DEV__) {
                                console.error(
                                    `Failed to load profile for session ${session.sessionId}`,
                                    error
                                );
                            }
                            return null;
                        }
                    })
                );

                if (!cancelled) {
                    setQuickAccounts(results.filter((item): item is QuickAccount => Boolean(item)));
                }
            } finally {
                if (!cancelled) {
                    setLoadingAccounts(false);
                }
            }
        };

        void loadQuickAccounts();

        return () => {
            cancelled = true;
        };
    }, [hasSessions, sessionsToShow, oxyServices, isAddAccountMode]);

    const handleSwitchAccount = useCallback(
        async (sessionId: string) => {
            setSwitchingSessionId(sessionId);
            try {
                await switchSession(sessionId);
                const switchedAccount =
                    quickAccounts.find((account) => account.sessionId === sessionId) ?? null;
                const successMessage =
                    t('signin.status.accountSwitched', {
                        name: switchedAccount?.displayName ?? t('signin.actions.openAccountSwitcher'),
                    }) || 'Account switched';
                toast.success(successMessage);
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
        [quickAccounts, switchSession, t]
    );

    const otherAccountsCount = sessionsToShow.length;

    // Get all accounts for avatar display (current user + quick accounts)
    const allAccountsForAvatars = useMemo(() => {
        const accounts: Array<{
            sessionId: string;
            displayName: string;
            username?: string;
            avatar?: string;
            isCurrent?: boolean;
        }> = [];

        // Add current user if in add account mode
        if (isAddAccountMode && user) {
            accounts.push({
                sessionId: activeSessionId || '',
                displayName: user.name?.full || user.username || 'Account',
                username: user.username,
                avatar: user.avatar,
                isCurrent: true,
            });
        }

        // Add quick accounts
        quickAccounts.forEach((account) => {
            accounts.push({
                sessionId: account.sessionId,
                displayName: account.displayName,
                username: account.username,
                avatar: account.avatar,
                isCurrent: account.sessionId === activeSessionId,
            });
        });

        return accounts;
    }, [isAddAccountMode, user, quickAccounts, activeSessionId]);

    const handleUsernameChange = (text: string) => {
        // Text is already filtered by formatValue prop, but ensure it's clean
        const filteredText = text.replace(/[^a-zA-Z0-9]/g, '');
        setUsername(filteredText);
        if (errorMessage) setErrorMessage('');
    };

    const handleContinue = async () => {
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
            // Validate the username before proceeding
            const isValid = await validateUsername(trimmedUsername);

            if (isValid) {
                nextStep();
            }
        } catch (error) {
            if (__DEV__) console.error('Error during username validation:', error);
            setErrorMessage('Unable to validate username. Please try again.');
        }
    };

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, { alignItems: 'flex-start' }]}>
                <HighFive width={100} height={100} />
            </View>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>
                    {isAddAccountMode ? t('signin.addAccountTitle') : t('signin.title')}
                </Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>
                    {isAddAccountMode ? t('signin.addAccountSubtitle') : t('signin.subtitle')}
                </Text>
            </View>

            {(isAddAccountMode && user) || (hasSessions && sessionsToShow.length > 0) ? (
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
                            {allAccountsForAvatars.length > 0 && (
                                <View style={stylesheet.avatarsContainer}>
                                    {allAccountsForAvatars.slice(0, 5).map((account, index) => (
                                        <View
                                            key={account.sessionId}
                                            style={[
                                                stylesheet.avatarWrapper,
                                                account.isCurrent && stylesheet.currentAvatarWrapper,
                                                index > 0 && { marginLeft: -12 },
                                                { zIndex: Math.min(allAccountsForAvatars.length, 5) - index },
                                                { borderColor: colors.inputBackground || colors.background || '#FFFFFF' },
                                            ]}
                                        >
                                            <Avatar
                                                name={account.displayName}
                                                text={account.displayName.charAt(0).toUpperCase()}
                                                size={28}
                                                theme={themeMode}
                                                backgroundColor={colors.primary}
                                                uri={account.avatar && oxyServices ? oxyServices.getFileDownloadUrl(account.avatar, 'thumb') : undefined}
                                            />
                                        </View>
                                    ))}
                                </View>
                            )}
                            {!showAccounts && (quickAccounts.length > 0 || otherAccountsCount > 0) && allAccountsForAvatars.length === 0 && (
                                <View style={[stylesheet.accountCountBadge, { backgroundColor: `${colors.primary}15` }]}>
                                    <Text style={[stylesheet.accountCountText, { color: colors.primary }]}>
                                        {otherAccountsCount + (isAddAccountMode && user ? 1 : 0)}
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
                                    {/* Show current account when in add account mode */}
                                    {isAddAccountMode && user && (
                                        <View
                                            style={[
                                                stylesheet.accountItem,
                                                {
                                                    backgroundColor: colors.inputBackground,
                                                },
                                            ]}
                                        >
                                            <Avatar
                                                name={user.name?.full || user.username}
                                                text={(user.name?.full || user.username || 'U')
                                                    .slice(0, 1)
                                                    .toUpperCase()}
                                                size={36}
                                                theme={themeMode}
                                                backgroundColor={`${colors.primary}25`}
                                            />
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
                                            key={account.sessionId}
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
                                                    <Avatar
                                                        name={account.displayName}
                                                        text={account.displayName.charAt(0).toUpperCase()}
                                                        size={36}
                                                        theme={themeMode}
                                                        backgroundColor={`${colors.primary}25`}
                                                    />
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
                                    {otherAccountsCount > MAX_QUICK_ACCOUNTS && (
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
                                                    count: otherAccountsCount - MAX_QUICK_ACCOUNTS,
                                                }) || `View ${otherAccountsCount - MAX_QUICK_ACCOUNTS} more`}
                                            </Text>
                                        </TouchableOpacity>
                                    )}
                                </>
                            )}
                        </View>
                    )}
                </View>
            ) : null}

            {/* "Or" divider */}
            {((isAddAccountMode && user) || (hasSessions && sessionsToShow.length > 0)) && (
                <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.dividerContainer]}>
                    <View style={[stylesheet.dividerLine, { backgroundColor: colors.border }]} />
                    <Text style={[stylesheet.dividerText, { color: colors.secondaryText }]}>
                        {t('signin.or') || 'or'}
                    </Text>
                    <View style={[stylesheet.dividerLine, { backgroundColor: colors.border }]} />
                </View>
            )}

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
    currentBadge: {
        position: 'absolute',
        bottom: -2,
        right: -2,
        width: 14,
        height: 14,
        borderRadius: 7,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 0,
    },
});
