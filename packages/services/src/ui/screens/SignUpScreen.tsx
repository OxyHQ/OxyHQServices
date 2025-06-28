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
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies, useThemeColors, createCommonStyles } from '../styles';
import OxyLogo from '../components/OxyLogo';
import { BottomSheetScrollView, BottomSheetView } from '../components/bottomSheet';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle } from 'react-native-svg';
import { toast } from '../../lib/sonner';

const SignUpScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
}) => {
    // Form data states
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');

    // Multi-step form states
    const [currentStep, setCurrentStep] = useState(0);
    const [isInputFocused, setIsInputFocused] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [validationStatus, setValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');

    // Cache for validation results
    const validationCache = useRef<Map<string, { available: boolean; timestamp: number }>>(new Map());

    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const heightAnim = useRef(new Animated.Value(400)).current;
    const [containerHeight, setContainerHeight] = useState(400);

    const { signUp, isLoading, user, isAuthenticated, oxyServices } = useOxy();

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);

    // Memoized styles to prevent rerenders
    const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

    // Input focus animations
    const handleInputFocus = useCallback(() => {
        setIsInputFocused(true);
    }, []);

    const handleInputBlur = useCallback(() => {
        setIsInputFocused(false);
    }, []);

    // Memoized input change handlers
    const handleUsernameChange = useCallback((text: string) => {
        setUsername(text);
        if (validationStatus === 'invalid') {
            setErrorMessage('');
            setValidationStatus('idle');
        }
    }, [validationStatus]);

    const handleEmailChange = useCallback((text: string) => {
        setEmail(text);
        setErrorMessage('');
    }, []);

    const handlePasswordChange = useCallback((text: string) => {
        setPassword(text);
        setErrorMessage('');
    }, []);

    const handleConfirmPasswordChange = useCallback((text: string) => {
        setConfirmPassword(text);
        setErrorMessage('');
    }, []);

    // Username availability validation using core services
    const validateUsername = useCallback(async (usernameToValidate: string) => {
        if (!usernameToValidate || usernameToValidate.length < 3) {
            setValidationStatus('invalid');
            return false;
        }

        // Check cache first (cache valid for 5 minutes)
        const cached = validationCache.current.get(usernameToValidate);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < 5 * 60 * 1000) {
            setValidationStatus(cached.available ? 'valid' : 'invalid');
            setErrorMessage(cached.available ? '' : 'Username is already taken');
            return cached.available;
        }

        setIsValidating(true);
        setValidationStatus('validating');

        try {
            const result = await oxyServices.checkUsernameAvailability(usernameToValidate);

            if (result.available) {
                setValidationStatus('valid');
                setErrorMessage('');

                // Cache the result
                validationCache.current.set(usernameToValidate, {
                    available: true,
                    timestamp: now
                });

                return true;
            } else {
                setValidationStatus('invalid');
                setErrorMessage(result.message || 'Username is already taken');

                // Cache the result
                validationCache.current.set(usernameToValidate, {
                    available: false,
                    timestamp: now
                });

                return false;
            }
        } catch (error: any) {
            console.error('Username validation error:', error);
            setValidationStatus('invalid');
            setErrorMessage('Unable to validate username. Please try again.');
            return false;
        } finally {
            setIsValidating(false);
        }
    }, [oxyServices]);

    // Debounced username validation
    useEffect(() => {
        if (!username || username.length < 3) {
            setValidationStatus('idle');
            setErrorMessage('');
            return;
        }

        const timeoutId = setTimeout(() => {
            validateUsername(username);
        }, 800);

        return () => clearTimeout(timeoutId);
    }, [username, validateUsername]);

    // Cleanup cache on unmount
    useEffect(() => {
        return () => {
            validationCache.current.clear();
        };
    }, []);

    // Animation functions
    const animateTransition = useCallback((nextStep: number) => {
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
        }).start(() => {
            setCurrentStep(nextStep);
            slideAnim.setValue(-100);

            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 250,
                    useNativeDriver: true,
                }),
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                })
            ]).start();
        });
    }, [fadeAnim, slideAnim]);

    const nextStep = useCallback(() => {
        if (currentStep < 3) {
            animateTransition(currentStep + 1);
        }
    }, [currentStep, animateTransition]);

    const prevStep = useCallback(() => {
        if (currentStep > 0) {
            animateTransition(currentStep - 1);
        }
    }, [currentStep, animateTransition]);

    const validateEmail = useCallback((email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }, []);

    const handleSignUp = useCallback(async () => {
        if (!username || !email || !password || !confirmPassword) {
            toast.error('Please fill in all fields');
            return;
        }

        if (!validateEmail(email)) {
            toast.error('Please enter a valid email address');
            return;
        }

        if (validationStatus !== 'valid') {
            toast.error('Please enter a valid username');
            return;
        }

        if (password !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            toast.error('Password must be at least 8 characters long');
            return;
        }

        try {
            setErrorMessage('');
            const user = await signUp(username, email, password);
            toast.success('Account created successfully! Welcome to Oxy!');
            // Call the onAuthenticated callback to notify parent components
            if (onAuthenticated) {
                onAuthenticated(user);
            }
        } catch (error: any) {
            toast.error(error.message || 'Sign up failed');
        }
    }, [username, email, password, confirmPassword, validationStatus, validateEmail, signUp, onAuthenticated]);

    // Step components
    const renderWelcomeStep = useMemo(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.welcomeImageContainer}>
                {/* Large illustration, not inside a circle */}
                <Svg width={220} height={120} viewBox="0 0 220 120">
                    {/* Example: Abstract friendly illustration */}
                    <Path
                        d="M30 100 Q60 20 110 60 Q160 100 190 40"
                        stroke={colors.primary}
                        strokeWidth="8"
                        fill="none"
                    />
                    <Circle cx="60" cy="60" r="18" fill={colors.primary} opacity="0.18" />
                    <Circle cx="110" cy="60" r="24" fill={colors.primary} opacity="0.25" />
                    <Circle cx="170" cy="50" r="14" fill={colors.primary} opacity="0.15" />
                    {/* Smiling face */}
                    <Circle cx="110" cy="60" r="32" fill="#fff" opacity="0.7" />
                    <Circle cx="100" cy="55" r="4" fill={colors.primary} />
                    <Circle cx="120" cy="55" r="4" fill={colors.primary} />
                    <Path
                        d="M104 68 Q110 75 116 68"
                        stroke={colors.primary}
                        strokeWidth="2"
                        fill="none"
                        strokeLinecap="round"
                    />
                </Svg>
            </View>

            <Text style={[styles.welcomeText, { color: colors.text }]}>
                We're excited to have you join us. Let's get your account set up in just a few easy steps.
            </Text>

            <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={nextStep}
                testID="welcome-next-button"
            >
                <Text style={styles.buttonText}>Get Started</Text>
            </TouchableOpacity>

            <View style={styles.footerTextContainer}>
                <Text style={[styles.footerText, { color: colors.text }]}>
                    Already have an account?{' '}
                </Text>
                <TouchableOpacity onPress={() => navigate('SignIn')}>
                    <Text style={[styles.linkText, { color: colors.primary }]}>Sign In</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, nextStep, navigate, styles]);

    const renderIdentityStep = useMemo(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <Text style={[styles.stepTitle, { color: colors.text }]}>Who are you?</Text>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: colors.text }]}>Username</Text>
                <View style={{ position: 'relative' }}>
                    <TextInput
                        style={[
                            styles.input,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }
                        ]}
                        placeholder="Choose a username"
                        placeholderTextColor={colors.placeholder}
                        value={username}
                        onChangeText={handleUsernameChange}
                        autoCapitalize="none"
                        testID="username-input"
                    />
                    {validationStatus === 'validating' && (
                        <ActivityIndicator size="small" color={colors.primary} style={styles.validationIndicator} />
                    )}
                    {validationStatus === 'valid' && (
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} style={styles.validationIndicator} />
                    )}
                    {validationStatus === 'invalid' && username.length >= 3 && (
                        <Ionicons name="close-circle" size={20} color={colors.error} style={styles.validationIndicator} />
                    )}
                </View>

                {/* Validation feedback */}
                {validationStatus === 'valid' && (
                    <View style={[styles.validationSuccessCard, { backgroundColor: colors.success + '15' }]}>
                        <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                        <Text style={[styles.validationText, { color: colors.success }]}>
                            Username is available
                        </Text>
                    </View>
                )}

                {validationStatus === 'invalid' && username.length >= 3 && (
                    <View style={[styles.validationErrorCard, { backgroundColor: colors.error + '15' }]}>
                        <Ionicons name="alert-circle" size={16} color={colors.error} />
                        <Text style={[styles.validationText, { color: colors.error }]}>
                            {errorMessage || 'Username is already taken'}
                        </Text>
                    </View>
                )}
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: colors.text }]}>Email</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }
                    ]}
                    placeholder="Enter your email"
                    placeholderTextColor={colors.placeholder}
                    value={email}
                    onChangeText={handleEmailChange}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    testID="email-input"
                />
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton, { borderColor: colors.border }]}
                    onPress={prevStep}
                >
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, { backgroundColor: colors.primary }]}
                    onPress={nextStep}
                    disabled={!username || !email || !validateEmail(email) || validationStatus !== 'valid'}
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>Next</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, username, email, validationStatus, errorMessage, handleUsernameChange, handleEmailChange, validateEmail, prevStep, nextStep, styles]);

    const renderSecurityStep = useMemo(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <Text style={[styles.stepTitle, { color: colors.text }]}>Secure your account</Text>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: colors.text }]}>Password</Text>
                <View style={{ position: 'relative' }}>
                    <TextInput
                        style={[
                            styles.input,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }
                        ]}
                        placeholder="Create a password"
                        placeholderTextColor={colors.placeholder}
                        value={password}
                        onChangeText={handlePasswordChange}
                        secureTextEntry={!showPassword}
                        testID="password-input"
                    />
                    <TouchableOpacity
                        style={styles.passwordToggle}
                        onPress={() => setShowPassword(!showPassword)}
                    >
                        <Ionicons
                            name={showPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={colors.placeholder}
                        />
                    </TouchableOpacity>
                </View>
                <Text style={[styles.passwordHint, { color: colors.secondaryText }]}>
                    Password must be at least 8 characters long
                </Text>
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: colors.text }]}>Confirm Password</Text>
                <View style={{ position: 'relative' }}>
                    <TextInput
                        style={[
                            styles.input,
                            { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.text }
                        ]}
                        placeholder="Confirm your password"
                        placeholderTextColor={colors.placeholder}
                        value={confirmPassword}
                        onChangeText={handleConfirmPasswordChange}
                        secureTextEntry={!showConfirmPassword}
                        testID="confirm-password-input"
                    />
                    <TouchableOpacity
                        style={styles.passwordToggle}
                        onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                        <Ionicons
                            name={showConfirmPassword ? 'eye-off' : 'eye'}
                            size={20}
                            color={colors.placeholder}
                        />
                    </TouchableOpacity>
                </View>
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton, { borderColor: colors.border }]}
                    onPress={prevStep}
                >
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, { backgroundColor: colors.primary }]}
                    onPress={nextStep}
                    disabled={!password || password.length < 8 || password !== confirmPassword}
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>Next</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, password, confirmPassword, showPassword, showConfirmPassword, handlePasswordChange, handleConfirmPasswordChange, prevStep, nextStep, styles]);

    const renderSummaryStep = useMemo(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <Text style={[styles.stepTitle, { color: colors.text }]}>Ready to join</Text>

            <View style={styles.summaryContainer}>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Username:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{username}</Text>
                </View>

                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Email:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{email}</Text>
                </View>
            </View>

            <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={handleSignUp}
                disabled={isLoading}
                testID="signup-button"
            >
                {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <Text style={styles.buttonText}>Create Account</Text>
                )}
            </TouchableOpacity>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton, { borderColor: colors.border }]}
                    onPress={prevStep}
                >
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, username, email, isLoading, handleSignUp, prevStep, styles]);

    const renderProgressIndicators = useMemo(() => (
        <View style={styles.progressContainer}>
            {[0, 1, 2, 3].map((step) => (
                <View
                    key={step}
                    style={[
                        styles.progressDot,
                        currentStep === step ?
                            { backgroundColor: colors.primary, width: 24 } :
                            { backgroundColor: colors.border }
                    ]}
                />
            ))}
        </View>
    ), [currentStep, colors, styles]);

    const renderCurrentStep = useCallback(() => {
        switch (currentStep) {
            case 0:
                return renderWelcomeStep;
            case 1:
                return renderIdentityStep;
            case 2:
                return renderSecurityStep;
            case 3:
                return renderSummaryStep;
            default:
                return renderWelcomeStep;
        }
    }, [currentStep, renderWelcomeStep, renderIdentityStep, renderSecurityStep, renderSummaryStep]);

    // If user is already authenticated, show user info and account center option
    if (user && isAuthenticated) {
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
                >
                    <Text style={[styles.welcomeTitle, { color: colors.text }]}>
                        Welcome, {user.username}!
                    </Text>

                    <View style={[styles.userInfoContainer, { backgroundColor: colors.inputBackground }]}>
                        <Text style={[styles.userInfoText, { color: colors.text }]}>
                            You are already signed in.
                        </Text>
                        {user.email && (
                            <Text style={[styles.userInfoText, { color: colors.secondaryText }]}>
                                Email: {user.email}
                            </Text>
                        )}
                    </View>

                    <View style={styles.actionButtonsContainer}>
                        <TouchableOpacity
                            style={[styles.button, { backgroundColor: colors.primary }]}
                            onPress={() => navigate('AccountCenter')}
                        >
                            <Text style={styles.buttonText}>Go to Account Center</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        );
    }

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
                {renderProgressIndicators}
                {renderCurrentStep()}
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
        paddingTop: 40,
        paddingBottom: 40,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: 500,
    },
    welcomeImageContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 30,
    },
    welcomeTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 42,
        lineHeight: 48,
        marginBottom: 24,
        textAlign: 'left',
        letterSpacing: -1,
    },
    welcomeText: {
        fontSize: 16,
        textAlign: 'left',
        marginBottom: 30,
        lineHeight: 24,
    },
    stepTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 34,
        marginBottom: 20,
        color: colors.primary,
        maxWidth: '90%',
        textAlign: 'left',
    },
    inputContainer: {
        marginBottom: 18,
        width: '100%',
    },
    label: {
        fontSize: 15,
        marginBottom: 8,
        fontWeight: '500',
        letterSpacing: 0.1,
    },
    input: {
        height: 48,
        borderRadius: 16,
        paddingHorizontal: 16,
        borderWidth: 1,
        fontSize: 16,
        marginBottom: 2,
    },
    validationIndicator: {
        position: 'absolute',
        right: 16,
        top: 14,
    },
    validationSuccessCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
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
    passwordToggle: {
        position: 'absolute',
        right: 16,
        top: 14,
        padding: 4,
    },
    passwordHint: {
        fontSize: 12,
        marginTop: 4,
    },
    button: {
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 24,
        shadowColor: colors.primary,
        shadowOpacity: 0.12,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 2,
        width: '100%',
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 17,
        fontWeight: '700',
        letterSpacing: 0.2,
    },
    footerTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 28,
    },
    footerText: {
        fontSize: 15,
    },
    linkText: {
        fontSize: 15,
        fontWeight: '700',
    },
    userInfoContainer: {
        padding: 20,
        marginVertical: 20,
        borderRadius: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 4,
        elevation: 1,
    },
    userInfoText: {
        fontSize: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    actionButtonsContainer: {
        marginTop: 24,
    },
    navigationButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 28,
        width: '100%',
    },
    navButton: {
        borderRadius: 24,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 28,
        backgroundColor: '#F3E5F5',
    },
    backButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
    },
    nextButton: {
        minWidth: 100,
    },
    navButtonText: {
        fontSize: 16,
        fontWeight: '700',
    },
    progressContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 20,
        marginTop: 8,
    },
    progressDot: {
        height: 10,
        width: 10,
        borderRadius: 5,
        marginHorizontal: 6,
        borderWidth: 2,
        borderColor: '#fff',
        shadowColor: colors.primary,
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
        elevation: 1,
    },
    summaryContainer: {
        padding: 0,
        marginBottom: 24,
        width: '100%',
    },
    summaryRow: {
        flexDirection: 'row',
        marginBottom: 10,
    },
    summaryLabel: {
        fontSize: 15,
        width: 90,
    },
    summaryValue: {
        fontSize: 15,
        fontWeight: '600',
        flex: 1,
    },
});

export default SignUpScreen;
