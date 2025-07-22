import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
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
    Animated,
    Dimensions,
    StatusBar,
    Alert,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies, useThemeColors, createCommonStyles } from '../styles';
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
}) => {
    // Form data states
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [userProfile, setUserProfile] = useState<any>(null);
    const [showPassword, setShowPassword] = useState(false);

    // Multi-step form states
    const [currentStep, setCurrentStep] = useState(0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');

    // Cache for validation results to prevent repeated API calls
    const validationCache = useRef<Map<string, { profile: any; timestamp: number }>>(new Map());

    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const scaleAnim = useRef(new Animated.Value(1)).current;
    const logoAnim = useRef(new Animated.Value(0)).current;
    const progressAnim = useRef(new Animated.Value(0.5)).current;

    const { login, isLoading, user, isAuthenticated, sessions, oxyServices } = useOxy();

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);

    // Check if this should be treated as "Add Account" mode
    const isAddAccountMode = useMemo(() =>
        isAuthenticated && sessions && sessions.length > 0,
        [isAuthenticated, sessions]
    );

    // Memoized styles to prevent rerenders
    const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

    // Initialize logo animation
    useEffect(() => {
        Animated.spring(logoAnim, {
            toValue: 1,
            tension: 50,
            friction: 8,
            useNativeDriver: true,
        }).start();
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
            const profile = await oxyServices.getUserProfileByUsername(usernameToValidate);

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
        Animated.timing(scaleAnim, {
            toValue: 0.95,
            duration: 150,
            useNativeDriver: true,
        }).start();

        // Fade out
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
        }).start(() => {
            setCurrentStep(nextStep);

            // Reset animations
            slideAnim.setValue(-50);
            scaleAnim.setValue(0.95);

            // Animate in new content
            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 300,
                    useNativeDriver: true,
                }),
                Animated.spring(slideAnim, {
                    toValue: 0,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: true,
                }),
                Animated.spring(scaleAnim, {
                    toValue: 1,
                    tension: 80,
                    friction: 8,
                    useNativeDriver: true,
                })
            ]).start();
        });
    }, [fadeAnim, slideAnim, scaleAnim]);

    const nextStep = useCallback(() => {
        if (currentStep < 1) {
            // Animate progress bar
            Animated.timing(progressAnim, {
                toValue: 1.0,
                duration: 300,
                useNativeDriver: false,
            }).start();

            animateTransition(currentStep + 1);
        }
    }, [currentStep, progressAnim, animateTransition]);

    const prevStep = useCallback(() => {
        if (currentStep > 0) {
            // Animate progress bar
            Animated.timing(progressAnim, {
                toValue: 0.5,
                duration: 300,
                useNativeDriver: false,
            }).start();

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
        />
    ), [
        fadeAnim, slideAnim, scaleAnim, colors, userProfile, username, theme, logoAnim,
        errorMessage, isInputFocused, password, showPassword,
        handleInputFocus, handleInputBlur, handlePasswordChange, handleSignIn, isLoading, prevStep, styles
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
                <View style={styles.footerTextContainer}>
                    <Text style={[styles.footerText, { color: colors.text }]}>Forgot your password? </Text>
                    <TouchableOpacity onPress={() => navigate('RecoverAccount')}>
                        <Text style={[styles.modernLinkText, { color: colors.primary }]}>Recover your account</Text>
                    </TouchableOpacity>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

// Memoized styles creation
const createStyles = (colors: any, theme: string) => StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 4,
        paddingBottom: 20,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
    },
    modernHeader: {
        alignItems: 'flex-start',
        width: '100%',
        marginBottom: 24,
    },
    modernTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 62,
        lineHeight: 48,
        marginBottom: 18,
        textAlign: 'left',
        letterSpacing: -1,
    },
    modernSubtitle: {
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'left',
        opacity: 0.8,
    },
    modernInfoCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        marginBottom: 24,
        gap: 12,
        width: '100%',
    },
    modernInfoText: {
        fontSize: 14,
        flex: 1,
    },
    modernErrorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        marginBottom: 24,
        gap: 12,
        width: '100%',
    },
    errorText: {
        fontSize: 14,
        fontWeight: '500',
        flex: 1,
    },
    modernInputContainer: {
        width: '100%',
        marginBottom: 24,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        borderRadius: 16,
        paddingHorizontal: 20,
        borderWidth: 2,
        backgroundColor: colors.inputBackground,
    },
    inputIcon: {
        marginRight: 12,
    },
    modernInput: {
        flex: 1,
        fontSize: 16,
        height: '100%',
    },
    passwordToggle: {
        padding: 4,
    },
    validationIndicator: {
        marginLeft: 8,
    },
    validationSuccessCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
    },
    belowInputMessage: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        marginBottom: 0,
        gap: 6,
    },
    belowInputText: {
        fontSize: 13,
        fontWeight: '500',
    },
    validationErrorCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
    },
    validationText: {
        fontSize: 12,
        fontWeight: '500',
    },
    modernButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 32,
        borderRadius: 16,
        marginVertical: 8,
        shadowOffset: {
            width: 0,
            height: 4,
        },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 6,
        gap: 8,
        width: '100%',
    },
    modernButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    buttonIcon: {
        marginLeft: 4,
    },

    // Enhanced Label Styles
    modernLabel: {
        fontSize: 12,
        fontWeight: '500',
        marginBottom: 2,
    },
    modernLinkText: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
        textDecorationLine: 'underline',
    },
    footerTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
    footerText: {
        fontSize: 15,
    },

    // Modern User Profile Styles
    modernUserProfileContainer: {
        alignItems: 'center',
        marginBottom: 32,
        paddingVertical: 24,
    },
    avatarContainer: {
        position: 'relative',
        marginBottom: 20,
    },
    modernUserAvatar: {
        borderWidth: 4,
        borderColor: 'rgba(209, 105, 229, 0.2)',
    },
    statusIndicator: {
        position: 'absolute',
        bottom: 4,
        right: 4,
        width: 20,
        height: 20,
        borderRadius: 10,
        borderWidth: 3,
        borderColor: '#FFFFFF',
    },
    modernUserDisplayName: {
        fontSize: 26,
        fontWeight: '700',
        marginBottom: 4,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    modernUsernameSubtext: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 16,
        opacity: 0.7,
    },
    welcomeBackBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 20,
        gap: 6,
    },
    welcomeBackText: {
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },

    // Modern Navigation
    modernNavigationButtons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        marginBottom: 8,
        width: '100%',
        gap: 8,
    },
    modernBackButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 20,
        borderRadius: 12,
        borderWidth: 1,
        gap: 8,
    },
    modernBackButtonText: {
        fontSize: 16,
        fontWeight: '500',
    },

    // Security Notice
    securityNotice: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 20,
        gap: 6,
    },
    securityText: {
        fontSize: 12,
        fontWeight: '500',
    },
});

export default SignInScreen;
