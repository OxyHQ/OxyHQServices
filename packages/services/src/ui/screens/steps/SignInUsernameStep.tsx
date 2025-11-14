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
import { useAccountStore, useAccounts, useAccountLoading, useAccountLoadingSession, type QuickAccount } from '../../stores/accountStore';
import { fontFamilies } from '../../styles/fonts';

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
    const [switchingSessionId, setSwitchingSessionId] = useState<string | null>(null);
    const [showAccounts, setShowAccounts] = useState(false);
    const previousSessionIdsRef = useRef<string>('');

    // Zustand store - use stable selectors
    const quickAccounts = useAccounts();
    const loadingAccounts = useAccountLoading();
    const isLoading = useAccountStore(state => state.loading);

    // Store actions are stable - get them once
    const loadAccountsRef = useRef(useAccountStore.getState().loadAccounts);
    const setAccountsRef = useRef(useAccountStore.getState().setAccounts);
    const moveAccountToTopRef = useRef(useAccountStore.getState().moveAccountToTop);

    // Update refs if store changes (shouldn't happen, but safe)
    useEffect(() => {
        loadAccountsRef.current = useAccountStore.getState().loadAccounts;
        setAccountsRef.current = useAccountStore.getState().setAccounts;
        moveAccountToTopRef.current = useAccountStore.getState().moveAccountToTop;
    }, []);

    const sessionsToLoad = useMemo(() => {
        const allSessions = sessions || [];
        return allSessions.slice(0, MAX_QUICK_ACCOUNTS);
    }, [sessions]);

    const sessionsToLoadIds = useMemo(
        () => sessionsToLoad.map(s => s.sessionId).sort().join(','),
        [sessionsToLoad]
    );

    useEffect(() => {
        if (previousSessionIdsRef.current === sessionsToLoadIds || isLoading) return;
        if (!sessionsToLoad.length || !oxyServices) {
            setAccountsRef.current([]);
            previousSessionIdsRef.current = sessionsToLoadIds;
            return;
        }

        previousSessionIdsRef.current = sessionsToLoadIds;

        const uniqueSessionIds = Array.from(new Set(sessionsToLoad.map(s => s.sessionId)));
        if (uniqueSessionIds.length === 0) {
            setAccountsRef.current([]);
            return;
        }

        const currentAccounts = useAccountStore.getState().accounts;
        const accountsArray = Object.values(currentAccounts);

        void loadAccountsRef.current(uniqueSessionIds, oxyServices, accountsArray);
    }, [sessionsToLoadIds, oxyServices, isLoading]);

    const handleSwitchAccount = useCallback(
        async (sessionId: string) => {
            if (switchingSessionId || sessionId === activeSessionId) return;

            setSwitchingSessionId(sessionId);
            moveAccountToTopRef.current(sessionId);

            switchSession(sessionId).catch((error) => {
                if (__DEV__) console.error('Failed to switch account:', error);
                const state = useAccountStore.getState();
                const account = state.accounts[sessionId];
                if (account) {
                    const filtered = Object.values(state.accounts).filter(a => a.sessionId !== sessionId);
                    setAccountsRef.current([...filtered, account]);
                }
                toast.error(t('signin.actions.switchAccountFailed') || 'Unable to switch accounts. Please try again.');
            }).finally(() => {
                setSwitchingSessionId(null);
            });
        },
        [switchSession, switchingSessionId, activeSessionId, t]
    );


    const accountsForDisplay = useMemo(() => {
        const sessionMap = new Map(sessions?.map(s => [s.sessionId, s]) || []);
        return quickAccounts.map(account => {
            const session = sessionMap.get(account.sessionId);
            const isCurrent = session?.isCurrent === true || account.sessionId === activeSessionId;
            return {
                ...account,
                isCurrent,
            };
        });
    }, [quickAccounts, sessions, activeSessionId]);

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

            {accountsForDisplay.length > 0 && (
                <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.dividerContainer]}>
                    <View style={[stylesheet.dividerLine, { backgroundColor: colors.border }]} />
                    <Text style={[stylesheet.dividerText, { color: colors.secondaryText }]}>
                        {t('signin.or') || 'or'}
                    </Text>
                    <View style={[stylesheet.dividerLine, { backgroundColor: colors.border }]} />
                </View>
            )}

            {accountsForDisplay.length > 0 ? (
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
                            {accountsForDisplay.length > 0 && (
                                <View style={stylesheet.avatarsContainer}>
                                    {accountsForDisplay.slice(0, 5).map((account, index) => (
                                        <View
                                            key={`avatar-${account.sessionId}`}
                                            style={[
                                                stylesheet.avatarWrapper,
                                                account.isCurrent && stylesheet.currentAvatarWrapper,
                                                index > 0 && { marginLeft: -12 },
                                                { zIndex: Math.min(accountsForDisplay.length, 5) - index },
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
                            {!showAccounts && accountsForDisplay.length === 0 && quickAccounts.length > 0 && (
                                <View style={[stylesheet.accountCountBadge, { backgroundColor: `${colors.primary}15` }]}>
                                    <Text style={[stylesheet.accountCountText, { color: colors.primary }]}>
                                        {quickAccounts.length}
                                    </Text>
                                </View>
                            )}
                        </View>
                    </TouchableOpacity>

                    {showAccounts && (
                        <View style={stylesheet.accountsList}>
                            {loadingAccounts && accountsForDisplay.length === 0 ? (
                                <View style={stylesheet.accountItem}>
                                    <ActivityIndicator color={colors.primary} size="small" />
                                </View>
                            ) : (
                                <>
                                    {accountsForDisplay.map((account) => (
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
                                            disabled={switchingSessionId === account.sessionId || account.isCurrent}
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
                                                    {account.isCurrent ? (
                                                        <View style={[stylesheet.currentAccountBadgeContainer, { backgroundColor: `${colors.primary}20` }]}>
                                                            <Text style={[stylesheet.currentAccountBadge, { color: colors.primary }]}>
                                                                {t('signin.currentAccount') || 'Current'}
                                                            </Text>
                                                        </View>
                                                    ) : null}
                                                </>
                                            )}
                                        </TouchableOpacity>
                                    ))}
                                    {sessions && sessions.length > MAX_QUICK_ACCOUNTS && (
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
                                                    count: sessions.length - MAX_QUICK_ACCOUNTS,
                                                }) || `View ${sessions.length - MAX_QUICK_ACCOUNTS} more`}
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
        justifyContent: 'space-between',
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
        paddingHorizontal: 12,
        paddingVertical: 5,
        borderRadius: 12,
        marginLeft: 'auto',
        minWidth: 60,
        alignItems: 'center',
        justifyContent: 'center',
    },
    currentAccountBadge: {
        fontSize: 11,
        fontFamily: fontFamilies.phuduExtraBold,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
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
