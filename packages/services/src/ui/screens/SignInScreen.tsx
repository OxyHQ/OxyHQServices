import type React from 'react';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeColors } from '../styles';
import { toast } from '../../lib/sonner';
import { useOxy } from '../context/OxyContext';
import StepBasedScreen, { type StepConfig } from '../components/StepBasedScreen';
import SignInUsernameStep from './steps/SignInUsernameStep';
import SignInPasswordStep from './steps/SignInPasswordStep';
import SignInTotpStep from './steps/SignInTotpStep';

const SignInScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
    initialStep,
    username: initialUsername,
    userProfile: initialUserProfile,
    currentScreen,
}) => {
    // Use useOxy() hook for OxyContext values
    const {
        login,
        completeMfaLogin,
        isLoading,
        user,
        isAuthenticated,
        sessions,
        activeSessionId,
        oxyServices,
        switchSession,
    } = useOxy();
    // Form data states - sync with props when they change from router navigation
    const [username, setUsername] = useState(initialUsername || '');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [userProfile, setUserProfile] = useState<any>(initialUserProfile || null);

    // Refs to store latest values for navigation prop extraction
    // These ensure we always get current state values, even if stepData memo hasn't updated yet
    const usernameRef = useRef<string>(initialUsername || '');
    const userProfileRef = useRef<any>(initialUserProfile || null);

    // Keep refs in sync with state
    useEffect(() => {
        usernameRef.current = username;
    }, [username]);

    useEffect(() => {
        userProfileRef.current = userProfile;
    }, [userProfile]);

    // Sync state with props when they change from router navigation (to preserve state across step changes)
    // This is critical because router navigation causes component remount, so we need to restore state from props
    useEffect(() => {
        if (initialUsername !== undefined) {
            // Always sync if prop is provided (even if empty string) to handle router navigation
            if (initialUsername !== username) {
                setUsername(initialUsername || '');
                usernameRef.current = initialUsername || '';
            }
        }
    }, [initialUsername]);

    useEffect(() => {
        if (initialUserProfile !== undefined) {
            // Always sync if prop is provided to handle router navigation
            const currentProfileId = (userProfile as any)?.id;
            const newProfileId = (initialUserProfile as any)?.id;
            if (currentProfileId !== newProfileId || initialUserProfile !== userProfile) {
                setUserProfile(initialUserProfile || null);
                userProfileRef.current = initialUserProfile || null;
            }
        }
    }, [initialUserProfile]);

    // Extraction function for navigation props - gets latest values from refs
    // This ensures we always have the current state, not stale memoized values
    const getNavigationProps = useCallback((): Record<string, unknown> => {
        const props: Record<string, unknown> = {};

        if (usernameRef.current) {
            props.username = usernameRef.current;
        }
        if (userProfileRef.current) {
            props.userProfile = userProfileRef.current;
        }

        if (__DEV__) {
            console.log('SignInScreen: getNavigationProps called', {
                username: usernameRef.current,
                hasUserProfile: !!userProfileRef.current,
            });
        }

        return props;
    }, []);
    const [showPassword, setShowPassword] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>(
        initialUserProfile ? 'valid' : 'idle'
    );
    const [existingSession, setExistingSession] = useState<any>(null);

    // Narrow theme type with default value
    const themeValue = (theme === 'light' || theme === 'dark') ? theme : 'light';
    const colors = useThemeColors(themeValue);

    // Check if this should be treated as "Add Account" mode
    const isAddAccountMode = useMemo(() =>
        isAuthenticated && sessions && sessions.length > 0,
        [isAuthenticated, sessions]
    );

    // Username validation using core services with caching
    const validateUsername = useCallback(async (usernameToValidate: string) => {
        if (!usernameToValidate || usernameToValidate.length < 3) {
            setValidationStatus('invalid');
            setErrorMessage('Username must be at least 3 characters.');
            return false;
        }

        // Safety check for oxyServices
        if (!oxyServices || typeof oxyServices.getProfileByUsername !== 'function') {
            console.error('oxyServices not available or getProfileByUsername not found');
            setValidationStatus('invalid');
            setErrorMessage('Service unavailable. Please try again.');
            return false;
        }

        const offlineDetected = typeof navigator !== 'undefined' && navigator.onLine === false;

        if (offlineDetected) {
            setValidationStatus('invalid');
            setErrorMessage('No connection. Check your internet connection and try again.');
            return false;
        }

        setIsValidating(true);
        setValidationStatus('validating');

        try {
            // Check if username exists
            const profile = await oxyServices.getProfileByUsername(usernameToValidate);

            // Handle case where profile might be wrapped in a data property (defensive check)
            const userProfile = (profile as any)?.data || profile;

            if (userProfile?.username) {
                const profileData = {
                    displayName: userProfile.name?.full || userProfile.name?.first || userProfile.username,
                    name: userProfile.username,
                    avatar: userProfile.avatar,
                    id: userProfile.id
                };

                setUserProfile(profileData);
                // Update ref immediately so it's available for navigation
                userProfileRef.current = profileData;

                // Check if this account is already signed in
                const profileUserId = userProfile.id?.toString();
                const existing = sessions?.find(s => {
                    const sessionUserId = s.userId?.toString();
                    return sessionUserId === profileUserId;
                });

                setExistingSession(existing || null);
                setValidationStatus('valid');
                setErrorMessage('');

                return true;
            }

            setValidationStatus('invalid');
            setErrorMessage('Username not found.');
            return false;
        } catch (error: any) {
            // If user not found (404), username doesn't exist
            if (error?.status === 404 || error?.code === 'USER_NOT_FOUND') {
                setValidationStatus('invalid');
                setErrorMessage('Username not found.');
                return false;
            }

            const isNetworkError =
                error?.status === 0 ||
                error?.code === 'ECONNABORTED' ||
                error?.code === 'ERR_NETWORK' ||
                error?.message?.toLowerCase?.().includes('network request failed') ||
                error?.message?.toLowerCase?.().includes('network error') ||
                error?.name === 'AbortError' ||
                error?.type === 'network';

            console.error('Username validation error:', error);
            setValidationStatus('invalid');
            setErrorMessage(
                isNetworkError
                    ? 'No connection. Check your internet connection and try again.'
                    : 'Unable to validate username. Please try again.'
            );
            return false;
        } finally {
            setIsValidating(false);
        }
    }, [oxyServices, sessions]);

    // Input change handlers
    const handleUsernameChange = useCallback((text: string) => {
        setUsername(text);
        if (errorMessage) setErrorMessage('');
        setValidationStatus('idle');
    }, [errorMessage]);

    const handlePasswordChange = useCallback((text: string) => {
        setPassword(text);
        if (errorMessage) setErrorMessage('');
    }, [errorMessage]);

    const handleInputFocus = useCallback(() => {
        setIsInputFocused(true);
    }, []);

    const handleInputBlur = useCallback(() => {
        setIsInputFocused(false);
    }, []);

    // Step validation and handlers
    const validateUsernameStep = useCallback(async () => {
        if (!username) {
            setErrorMessage('Please enter your username.');
            return false;
        }
        setErrorMessage('');
        setIsValidating(true);
        const valid = await validateUsername(username);
        setIsValidating(false);
        return valid;
    }, [username, validateUsername]);

    const [mfaToken, setMfaToken] = useState<string | null>(null);

    const handleContinueWithExistingAccount = useCallback(async () => {
        if (!existingSession) return;

        try {
            setErrorMessage('');
            await switchSession(existingSession.sessionId);
            // Get the user for the authenticated callback
            const currentUser = await oxyServices.getUserBySession(existingSession.sessionId);
            if (onAuthenticated) {
                onAuthenticated(currentUser);
            }
        } catch (error: any) {
            setErrorMessage(error.message || 'Failed to switch account');
        }
    }, [existingSession, switchSession, oxyServices, onAuthenticated]);

    const handleSignIn = useCallback(async () => {
        // Use current values - props first (from router), then state
        // Same logic as currentUsername/currentUserProfile above to ensure consistency
        const currentUsername = (initialUsername !== undefined && initialUsername !== null && initialUsername !== '')
            ? initialUsername
            : username;
        const currentUserProfile = (initialUserProfile !== undefined && initialUserProfile !== null)
            ? initialUserProfile
            : userProfile;

        if (__DEV__) {
            console.log('handleSignIn called', {
                initialUsername,
                username,
                currentUsername,
                hasUserProfile: !!currentUserProfile,
                hasPassword: !!password,
            });
        }

        if (!password) {
            setErrorMessage('Please enter your password.');
            return;
        }
        if (!currentUsername || !currentUserProfile) {
            if (__DEV__) {
                console.warn('handleSignIn: Missing username or userProfile', {
                    currentUsername,
                    hasUserProfile: !!currentUserProfile,
                    initialUsername,
                    initialUserProfile: !!initialUserProfile,
                    username,
                    userProfile: !!userProfile,
                });
            }
            setErrorMessage('Please enter a valid username first.');
            return;
        }

        try {
            setErrorMessage('');
            const user = await login(currentUsername, password);
            if (onAuthenticated) {
                onAuthenticated(user);
            }
        } catch (error: any) {
            if (error?.code === 'MFA_REQUIRED' && error?.mfaToken) {
                setMfaToken(error.mfaToken);
                return; // Password step will auto-advance when MFA token is set
            }
            setErrorMessage(error.message || 'Login failed');
        }
    }, [username, password, login, onAuthenticated, userProfile, initialUsername, initialUserProfile]);

    // Step configurations
    const steps: StepConfig[] = useMemo(() => {
        const base: StepConfig[] = [
            { id: 'username', component: SignInUsernameStep, canProceed: () => true },
            { id: 'password', component: SignInPasswordStep, canProceed: () => true },
        ];
        if (mfaToken) {
            base.push({ id: 'totp', component: SignInTotpStep, canProceed: () => true });
        }
        return base;
    }, [mfaToken, username, password, validationStatus, validateUsername, handleSignIn]);

    // Handle step completion (final step)
    const handleComplete = useCallback(async (stepData: any[]) => {
        // The sign-in is handled by the password step component
        // This callback is here for interface compatibility
    }, []);

    // Use props directly when available (from router navigation), fallback to state
    // This ensures values are available immediately on remount, before useEffect syncs
    // IMPORTANT: Always prefer props from router over state to avoid stale values after remount
    const currentUsername = (initialUsername !== undefined && initialUsername !== null && initialUsername !== '')
        ? initialUsername
        : username;
    const currentUserProfile = (initialUserProfile !== undefined && initialUserProfile !== null)
        ? initialUserProfile
        : userProfile;

    // Debug logging in dev mode
    if (__DEV__) {
        if (initialStep === 1) {
            console.log('SignInScreen: Password step render', {
                initialUsername,
                username,
                currentUsername,
                hasUserProfile: !!currentUserProfile,
                initialUserProfile: !!initialUserProfile,
            });
        }
    }

    // Step data for the reusable component
    const stepData = useMemo(() => [
        {
            username: currentUsername,
            setUsername: handleUsernameChange,
            errorMessage,
            setErrorMessage,
            validationStatus,
            userProfile: currentUserProfile,
            isValidating,
            isInputFocused,
            isAddAccountMode,
            user,
            handleInputFocus,
            handleInputBlur,
            validateUsername, // Add validation function
            // OxyContext values for step components (instead of useOxy hook)
            sessions,
            activeSessionId,
            switchSession,
        },
        {
            password,
            setPassword: handlePasswordChange,
            showPassword,
            setShowPassword,
            errorMessage,
            setErrorMessage,
            isLoading,
            isInputFocused,
            userProfile: currentUserProfile,
            username: currentUsername,
            handleInputFocus,
            handleInputBlur,
            handleSignIn, // Add sign-in function for password step
            mfaToken,
            existingSession,
            handleContinueWithExistingAccount,
        },
        ...(mfaToken ? [{
            username: currentUsername,
            mfaToken,
            completeMfaLogin,
            onAuthenticated,
            errorMessage,
            setErrorMessage,
            isLoading,
        }] : []),
    ], [
        currentUsername, currentUserProfile, password, errorMessage, validationStatus, mfaToken,
        isValidating, isInputFocused, isAddAccountMode, user, showPassword,
        isLoading, handleUsernameChange, handlePasswordChange, handleInputFocus, handleInputBlur,
        validateUsername, handleSignIn, completeMfaLogin, onAuthenticated, existingSession, handleContinueWithExistingAccount,
        initialUsername, initialUserProfile, // Include props in dependencies
        sessions, activeSessionId, switchSession // Include OxyContext values
    ]);

    // Ensure initialStep is a number (defensive check)
    const safeInitialStep = typeof initialStep === 'number' ? initialStep : 0;

    return (
        <StepBasedScreen
            steps={steps}
            initialStep={safeInitialStep}
            stepData={stepData}
            onComplete={handleComplete}
            navigate={navigate!}
            goBack={goBack}
            onAuthenticated={onAuthenticated}
            theme={theme}
            currentScreen={currentScreen}
            getNavigationProps={getNavigationProps}
            showProgressIndicator={true}
            enableAnimations={true}
            oxyServices={oxyServices}
        />
    );
};



export default SignInScreen;
