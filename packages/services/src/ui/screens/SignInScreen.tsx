import type React from 'react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Platform,
    KeyboardAvoidingView,
    ScrollView,
    TextStyle,
    Dimensions,
    StatusBar,
    Alert,
} from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    interpolate,
    runOnJS,
    Easing,
} from 'react-native-reanimated';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies, useThemeColors, createCommonStyles, createAuthStyles } from '../styles';
import OxyLogo from '../components/OxyLogo';
import Avatar from '../components/Avatar';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../assets/illustrations/HighFive';
import { toast } from '../../lib/sonner';
import Svg, { Path, Circle } from 'react-native-svg';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import TextField from '../components/internal/TextField';
import SignInUsernameStep from './internal/SignInUsernameStep';
import SignInPasswordStep from './internal/SignInPasswordStep';

const SignInScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
    initialStep,
    username: initialUsername,
    userProfile: initialUserProfile,
}) => {
    // Only log props in development mode to reduce console noise
    if (__DEV__) {
        console.log('SignInScreen props:', { initialStep, initialUsername, initialUserProfile });
    }
    // Form data states
    const [username, setUsername] = useState(initialUsername || '');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [userProfile, setUserProfile] = useState<any>(initialUserProfile || null);
    const [showPassword, setShowPassword] = useState(false);

    // Multi-step form states
    const [currentStep, setCurrentStep] = useState(initialStep || 0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>(
        initialUserProfile ? 'valid' : 'idle'
    );

    // Cache for validation results to prevent repeated API calls
    const validationCache = useRef<Map<string, { profile: any; timestamp: number }>>(new Map());

    // Reanimated shared values
    const fadeAnim = useSharedValue(1);
    const slideAnim = useSharedValue(0);
    const scaleAnim = useSharedValue(1);
    const logoAnim = useSharedValue(0);
    const progressAnim = useSharedValue(initialStep ? 1.0 : 0.5);

    const { login, isLoading, user, isAuthenticated, sessions, oxyServices } = useOxy();

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);

    // Check if this should be treated as "Add Account" mode
    const isAddAccountMode = useMemo(() =>
        isAuthenticated && sessions && sessions.length > 0,
        [isAuthenticated, sessions]
    );

    // Memoized styles to prevent rerenders
    const styles = useMemo(() => createAuthStyles(colors, theme), [colors, theme]);

    // Initialize logo animation
    useEffect(() => {
        logoAnim.value = withSpring(1, {
            damping: 15,
            stiffness: 150,
        });
    }, [logoAnim]);

    // Input focus handlers (no animation)
    const handleInputFocus = useCallback(() => {
        setIsInputFocused(true);
    }, []);

    const handleInputBlur = useCallback(() => {
        setIsInputFocused(false);
    }, []);

    // Memoized input change handlers to prevent re-renders
    const handleUsernameChange = useCallback((text: string) => {
        setUsername(text);
        // Clear error as soon as user edits username
        if (errorMessage) setErrorMessage('');
        setValidationStatus('idle');
    }, [errorMessage]);

    const handlePasswordChange = useCallback((text: string) => {
        setPassword(text);
        // Clear error as soon as user edits password
        if (errorMessage) setErrorMessage('');
    }, [errorMessage]);

    // Username validation using core services with caching
    const validateUsername = useCallback(async (usernameToValidate: string) => {
        if (!usernameToValidate || usernameToValidate.length < 3) {
            setValidationStatus('invalid');
            setErrorMessage('Please enter a valid username.');
            return false;
        }

        // Check cache first (cache valid for 5 minutes)
        const cached = validationCache.current.get(usernameToValidate);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < 5 * 60 * 1000) {
            setUserProfile(cached.profile);
            setValidationStatus('valid');
            setErrorMessage('');
            return true;
        }

        setIsValidating(true);
        setValidationStatus('validating');

        try {
            // First check if username exists by trying to get profile
            const profile = await oxyServices.getProfileByUsername(usernameToValidate);

            if (profile) {
                const profileData = {
                    displayName: profile.name?.full || profile.name?.first || profile.username,
                    name: profile.username,
                    avatar: profile.avatar,
                    id: profile.id
                };

                setUserProfile(profileData);
                setValidationStatus('valid');
                setErrorMessage(''); // Clear any previous errors

                // Cache the result
                validationCache.current.set(usernameToValidate, {
                    profile: profileData,
                    timestamp: now
                });

                return true;
            } else {
                setValidationStatus('invalid');
                setErrorMessage('Username not found.');
                return false;
            }
        } catch (error: any) {
            // If user not found (404), username doesn't exist
            if (error.status === 404 || error.code === 'USER_NOT_FOUND') {
                setValidationStatus('invalid');
                setErrorMessage('Username not found.');
                return false;
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

    // Debounced username validation - only run on explicit continue, not on every keystroke
    useEffect(() => {
        if (!username || username.length < 3) {
            setValidationStatus('idle');
            setUserProfile(null);
            setErrorMessage('');
            return;
        }
        // Only validate if we haven't already validated this exact username
        if (validationStatus === 'valid' && userProfile?.name === username) {
            return;
        }
        // Remove debounce, only validate on continue
    }, [username, validationStatus, userProfile?.name]);

    // Cleanup cache on unmount and limit cache size
    useEffect(() => {
        return () => {
            // Clear cache on unmount
            validationCache.current.clear();
        };
    }, []);

    // Clean up old cache entries periodically (older than 10 minutes)
    useEffect(() => {
        const cleanupInterval = setInterval(() => {
            const now = Date.now();
            const maxAge = 10 * 60 * 1000; // 10 minutes

            for (const [key, value] of validationCache.current.entries()) {
                if (now - value.timestamp > maxAge) {
                    validationCache.current.delete(key);
                }
            }

            // Limit cache size to 50 entries
            if (validationCache.current.size > 50) {
                const entries = Array.from(validationCache.current.entries());
                entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
                const toDelete = entries.slice(0, entries.length - 50);
                toDelete.forEach(([key]) => validationCache.current.delete(key));
            }
        }, 5 * 60 * 1000); // Clean up every 5 minutes

        return () => clearInterval(cleanupInterval);
    }, []);

    // Animation functions
    const animateTransition = useCallback((nextStep: number) => {
        // Scale down current content
        scaleAnim.value = withTiming(0.95, { duration: 150 });

        // Fade out and then animate in new content
        fadeAnim.value = withTiming(0, { duration: 200 }, (finished) => {
            if (finished) {
                runOnJS(setCurrentStep)(nextStep);
                
                // Reset animations
                slideAnim.value = -50;
                scaleAnim.value = 0.95;

                // Animate in new content
                fadeAnim.value = withTiming(1, { duration: 300 });
                slideAnim.value = withSpring(0, {
                    damping: 15,
                    stiffness: 200,
                });
                scaleAnim.value = withSpring(1, {
                    damping: 15,
                    stiffness: 200,
                });
            }
        });
    }, [fadeAnim, slideAnim, scaleAnim]);

    const nextStep = useCallback(() => {
        if (currentStep < 1) {
            // Animate progress bar
            progressAnim.value = withTiming(1.0, { duration: 300 });
            animateTransition(currentStep + 1);
        }
    }, [currentStep, progressAnim, animateTransition]);

    const prevStep = useCallback(() => {
        if (currentStep > 0) {
            // Animate progress bar
            progressAnim.value = withTiming(0.5, { duration: 300 });
            animateTransition(currentStep - 1);
        }
    }, [currentStep, progressAnim, animateTransition]);

    // Custom next handlers for validation
    const handleUsernameContinue = useCallback(async () => {
        if (!username) {
            setErrorMessage('Please enter your username.');
            return;
        }
        setErrorMessage('');
        setIsValidating(true);
        const valid = await validateUsername(username);
        setIsValidating(false);
        if (!valid) {
            // Error message is set in validateUsername
            return;
        }
        nextStep();
    }, [username, validateUsername, nextStep]);

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

    // Memoized step components
    const renderUsernameStep = useMemo(() => (
        <SignInUsernameStep
            styles={styles}
            fadeAnim={fadeAnim}
            slideAnim={slideAnim}
            scaleAnim={scaleAnim}
            colors={colors}
            isAddAccountMode={isAddAccountMode}
            user={user}
            errorMessage={errorMessage}
            isInputFocused={isInputFocused}
            username={username}
            validationStatus={validationStatus}
            userProfile={userProfile}
            isValidating={isValidating}
            handleInputFocus={handleInputFocus}
            handleInputBlur={handleInputBlur}
            handleUsernameChange={handleUsernameChange}
            handleUsernameContinue={handleUsernameContinue}
            navigate={navigate}
        />
    ), [
        fadeAnim, slideAnim, scaleAnim, colors, isAddAccountMode, user?.username,
        errorMessage, isInputFocused, username, validationStatus,
        userProfile, isValidating, handleInputFocus, handleInputBlur, handleUsernameChange,
        handleUsernameContinue, navigate, styles
    ]);

    const renderPasswordStep = useMemo(() => (
        <SignInPasswordStep
            styles={styles}
            fadeAnim={fadeAnim}
            slideAnim={slideAnim}
            scaleAnim={scaleAnim}
            colors={colors}
            userProfile={userProfile}
            username={username}
            theme={theme}
            logoAnim={logoAnim}
            errorMessage={errorMessage}
            isInputFocused={isInputFocused}
            password={password}
            showPassword={showPassword}
            handleInputFocus={handleInputFocus}
            handleInputBlur={handleInputBlur}
            handlePasswordChange={handlePasswordChange}
            handleSignIn={handleSignIn}
            isLoading={isLoading}
            prevStep={prevStep}
            navigate={navigate}
        />
    ), [
        fadeAnim, slideAnim, scaleAnim, colors, userProfile, username, theme, logoAnim,
        errorMessage, isInputFocused, password, showPassword,
        handleInputFocus, handleInputBlur, handlePasswordChange, handleSignIn, isLoading, prevStep, styles, navigate
    ]);

    const renderCurrentStep = useCallback(() => {
        switch (currentStep) {
            case 0:
                return renderUsernameStep;
            case 1:
                return renderPasswordStep;
            default:
                return renderUsernameStep;
        }
    }, [currentStep, renderUsernameStep, renderPasswordStep]);

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {renderCurrentStep()}
            </ScrollView>
        </KeyboardAvoidingView>
    );
};



export default SignInScreen;
