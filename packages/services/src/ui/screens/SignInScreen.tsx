import type React from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { useThemeColors } from '../styles';
import { toast } from '../../lib/sonner';
import StepBasedScreen, { type StepConfig } from '../components/StepBasedScreen';
import SignInUsernameStep from './steps/SignInUsernameStep';
import SignInPasswordStep from './steps/SignInPasswordStep';

const SignInScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
    initialStep,
    username: initialUsername,
    userProfile: initialUserProfile,
}) => {
    // Form data states
    const [username, setUsername] = useState(initialUsername || '');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [userProfile, setUserProfile] = useState<any>(initialUserProfile || null);
    const [showPassword, setShowPassword] = useState(false);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>(
        initialUserProfile ? 'valid' : 'idle'
    );

    // Monitor username state changes
    useEffect(() => {
        console.log('👀 SignInScreen username state changed:', username);
    }, [username]);

    // Cache for validation results to prevent repeated API calls
    const validationCache = useRef<Map<string, { profile: any }>>(new Map());

    const { login, isLoading, user, isAuthenticated, sessions, oxyServices } = useOxy();

    // Only log props in development mode to reduce console noise
    if (__DEV__) {
        console.log('SignInScreen props:', { initialStep, initialUsername, initialUserProfile });
        console.log('🔧 oxyServices available:', !!oxyServices);
        console.log('🔧 getProfileByUsername available:', typeof oxyServices?.getProfileByUsername);
    }
    const colors = useThemeColors(theme);

    // Check if this should be treated as "Add Account" mode
    const isAddAccountMode = useMemo(() =>
        isAuthenticated && sessions && sessions.length > 0,
        [isAuthenticated, sessions]
    );

    // Username validation using core services with caching
    const validateUsername = useCallback(async (usernameToValidate: string) => {
        console.log('🔍 Validating username:', usernameToValidate);

        if (!usernameToValidate || usernameToValidate.length < 3) {
            console.log('❌ Username too short');
            setValidationStatus('invalid');
            setErrorMessage('Username must be at least 3 characters.');
            return false;
        }

        // Safety check for oxyServices
        if (!oxyServices || typeof oxyServices.getProfileByUsername !== 'function') {
            console.error('🚨 oxyServices not available or getProfileByUsername not found');
            setValidationStatus('invalid');
            setErrorMessage('Service unavailable. Please try again.');
            return false;
        }

        // Check cache first
        const cached = validationCache.current.get(usernameToValidate);
        if (cached) {
            console.log('✅ Username found in cache:', cached.profile);
            setUserProfile(cached.profile);
            setValidationStatus('valid');
            setErrorMessage('');
            return true;
        }

        console.log('🔄 Validating username with API...');
        setIsValidating(true);
        setValidationStatus('validating');

        try {
            // Check if username exists
            const profile = await oxyServices.getProfileByUsername(usernameToValidate);
            console.log('📋 Profile response:', profile);

            if (profile && profile.username) {
                const profileData = {
                    displayName: profile.name?.full || profile.name?.first || profile.username,
                    name: profile.username,
                    avatar: profile.avatar,
                    id: profile.id
                };

                console.log('✅ Username is valid:', profileData);
                setUserProfile(profileData);
                setValidationStatus('valid');
                setErrorMessage('');

                // Cache the result
                validationCache.current.set(usernameToValidate, {
                    profile: profileData
                });

                return true;
            } else {
                console.log('❌ Username not found');
                setValidationStatus('invalid');
                setErrorMessage('Username not found.');
                return false;
            }
        } catch (error: any) {
            console.log('🚨 Validation error:', error);

            // If user not found (404), username doesn't exist
            if (error.status === 404 || error.code === 'USER_NOT_FOUND') {
                console.log('❌ Username not found (404)');
                setValidationStatus('invalid');
                setErrorMessage('Username not found.');
                return false;
            }

            // For development/testing: if API fails, allow any 3+ character username
            if (__DEV__) {
                console.log('⚠️ Development mode: allowing username due to API error');
                setValidationStatus('valid');
                setErrorMessage('');
                return true;
            }

            // For other errors, show generic message
            console.error('Username validation error:', error);
            setValidationStatus('invalid');
            setErrorMessage('Unable to validate username. Please try again.');
            return false;
        } finally {
            setIsValidating(false);
        }
    }, [oxyServices]);

    // Input change handlers
    const handleUsernameChange = useCallback((text: string) => {
        console.log('🔄 SignInScreen handleUsernameChange called:', text);
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

    const handleSignIn = useCallback(async () => {
        if (!password) {
            setErrorMessage('Please enter your password.');
            return;
        }
        if (!username || !userProfile) {
            setErrorMessage('Please enter a valid username first.');
            return;
        }
        try {
            setErrorMessage('');
            const user = await login(username, password);
            if (onAuthenticated) {
                onAuthenticated(user);
            }
        } catch (error: any) {
            setErrorMessage(error.message || 'Login failed');
        }
    }, [username, password, login, onAuthenticated, userProfile]);

    // Simple cleanup on unmount - that's all we need for username validation
    useEffect(() => {
        return () => {
            validationCache.current.clear();
        };
    }, []);

    // Step configurations
    const steps: StepConfig[] = useMemo(() => [
        {
            id: 'username',
            component: SignInUsernameStep,
            canProceed: () => true, // Let the component handle validation internally
        },
        {
            id: 'password',
            component: SignInPasswordStep,
            canProceed: () => true, // Let the component handle validation internally
        },
    ], [username, password, validationStatus, validateUsername, handleSignIn]);

    // Handle step completion (final step)
    const handleComplete = useCallback(async (stepData: any[]) => {
        // The sign-in is handled by the password step component
        // This callback is here for interface compatibility
        console.log('Sign-in flow completed');
    }, []);

    // Step data for the reusable component
    const stepData = useMemo(() => [
        {
            username,
            setUsername: handleUsernameChange,
            errorMessage,
            setErrorMessage,
            validationStatus,
            userProfile,
            isValidating,
            isInputFocused,
            isAddAccountMode,
            user,
            handleInputFocus,
            handleInputBlur,
            validateUsername, // Add validation function
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
            userProfile,
            username,
            handleInputFocus,
            handleInputBlur,
            handleSignIn, // Add sign-in function for password step
        },
    ], [
        username, password, errorMessage, validationStatus, userProfile,
        isValidating, isInputFocused, isAddAccountMode, user, showPassword,
        isLoading, handleUsernameChange, handlePasswordChange, handleInputFocus, handleInputBlur,
        validateUsername, handleSignIn
    ]);

    return (
        <StepBasedScreen
            steps={steps}
            initialStep={initialStep}
            stepData={stepData}
            onComplete={handleComplete}
            navigate={navigate}
            goBack={goBack}
            onAuthenticated={onAuthenticated}
            theme={theme}
            showProgressIndicator={true}
            enableAnimations={true}
            oxyServices={oxyServices}
        />
    );
};



export default SignInScreen;
