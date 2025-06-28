import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
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
    Animated,
    StatusBar,
    Alert,
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { useThemeColors, createCommonStyles } from '../styles';
import { BottomSheetScrollView } from '../components/bottomSheet';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle } from 'react-native-svg';
import { toast } from '../../lib/sonner';
import HighFive from '../../assets/illustrations/HighFive';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import TextField from '../components/internal/TextField';

// Types for better type safety
interface FormData {
    username: string;
    email: string;
    password: string;
    confirmPassword: string;
}

interface ValidationState {
    status: 'idle' | 'validating' | 'valid' | 'invalid';
    message: string;
}

interface PasswordVisibility {
    password: boolean;
    confirmPassword: boolean;
}

// Constants
const USERNAME_MIN_LENGTH = 3;
const PASSWORD_MIN_LENGTH = 8;
const VALIDATION_DEBOUNCE_MS = 800;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Styles factory function
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
        fontSize: 42,
        lineHeight: 48,
        marginBottom: 12,
        textAlign: 'left',
        letterSpacing: -1,
    },
    modernSubtitle: {
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'left',
        opacity: 0.8,
        marginBottom: 24,
    },
    welcomeImageContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 20,
    },
    welcomeTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 42,
        lineHeight: 48,
        marginBottom: 12,
        textAlign: 'left',
        letterSpacing: -1,
    },
    welcomeText: {
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'left',
        opacity: 0.8,
        marginBottom: 24,
    },
    stepTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 42,
        lineHeight: 48,
        marginBottom: 12,
        textAlign: 'left',
        letterSpacing: -1,
    },
    inputContainer: {
        width: '100%',
        marginBottom: 24,
    },
    premiumInputWrapper: {
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
    inputContent: {
        flex: 1,
    },
    modernLabel: {
        fontSize: 12,
        fontWeight: '500',
        marginBottom: 2,
    },
    modernInput: {
        flex: 1,
        fontSize: 16,
        height: '100%',
    },
    validationIndicator: {
        marginLeft: 8,
    },
    validationCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
    },
    validationIconContainer: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    validationTextContainer: {
        flex: 1,
    },
    validationTitle: {
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 2,
    },
    validationSubtitle: {
        fontSize: 11,
        opacity: 0.8,
    },
    passwordToggle: {
        padding: 4,
    },
    passwordHint: {
        fontSize: 12,
        marginTop: 4,
    },
    button: {
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
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    footerTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
    },
    footerText: {
        fontSize: 15,
    },
    linkText: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
        textDecorationLine: 'underline',
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
        justifyContent: 'center',
        marginTop: 16,
        marginBottom: 8,
        width: '100%',
        gap: 8,
    },
    navButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 12,
        gap: 6,
        minWidth: 70,
        borderWidth: 1,
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    backButton: {
        backgroundColor: 'transparent',
        borderTopLeftRadius: 35,
        borderBottomLeftRadius: 35,
        borderTopRightRadius: 12,
        borderBottomRightRadius: 12,
    },
    nextButton: {
        backgroundColor: 'transparent',
        borderTopRightRadius: 35,
        borderBottomRightRadius: 35,
        borderTopLeftRadius: 12,
        borderBottomLeftRadius: 12,
    },
    navButtonText: {
        fontSize: 13,
        fontWeight: '500',
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

// Custom hooks for better separation of concerns
const useFormValidation = (oxyServices: any) => {
    const [validationState, setValidationState] = useState<ValidationState>({
        status: 'idle',
        message: ''
    });

    const validationCache = useRef<Map<string, { available: boolean; timestamp: number }>>(new Map());

    const validateUsername = useCallback(async (username: string): Promise<boolean> => {
        if (!username || username.length < USERNAME_MIN_LENGTH) {
            setValidationState({ status: 'invalid', message: '' });
            return false;
        }

        // Check cache first
        const cached = validationCache.current.get(username);
        const now = Date.now();
        if (cached && (now - cached.timestamp) < CACHE_DURATION_MS) {
            const isValid = cached.available;
            setValidationState({
                status: isValid ? 'valid' : 'invalid',
                message: isValid ? '' : 'Username is already taken'
            });
            return isValid;
        }

        setValidationState({ status: 'validating', message: '' });

        try {
            const result = await oxyServices.checkUsernameAvailability(username);
            const isValid = result.available;

            // Cache the result
            validationCache.current.set(username, {
                available: isValid,
                timestamp: now
            });

            setValidationState({
                status: isValid ? 'valid' : 'invalid',
                message: isValid ? '' : (result.message || 'Username is already taken')
            });

            return isValid;
        } catch (error: any) {
            console.error('Username validation error:', error);
            setValidationState({
                status: 'invalid',
                message: 'Unable to validate username. Please try again.'
            });
            return false;
        }
    }, [oxyServices]);

    const validateEmail = useCallback((email: string): boolean => {
        return EMAIL_REGEX.test(email);
    }, []);

    const validatePassword = useCallback((password: string): boolean => {
        return password.length >= PASSWORD_MIN_LENGTH;
    }, []);

    const validatePasswordsMatch = useCallback((password: string, confirmPassword: string): boolean => {
        return password === confirmPassword;
    }, []);

    // Cleanup cache on unmount
    useEffect(() => {
        return () => {
            validationCache.current.clear();
        };
    }, []);

    return {
        validationState,
        validateUsername,
        validateEmail,
        validatePassword,
        validatePasswordsMatch
    };
};

const useFormData = () => {
    const [formData, setFormData] = useState<FormData>({
        username: '',
        email: '',
        password: '',
        confirmPassword: ''
    });

    const [passwordVisibility, setPasswordVisibility] = useState<PasswordVisibility>({
        password: false,
        confirmPassword: false
    });

    const updateField = useCallback((field: keyof FormData, value: string) => {
        setFormData(prev => ({ ...prev, [field]: value }));
    }, []);

    const togglePasswordVisibility = useCallback((field: keyof PasswordVisibility) => {
        setPasswordVisibility(prev => ({ ...prev, [field]: !prev[field] }));
    }, []);

    const resetForm = useCallback(() => {
        setFormData({
            username: '',
            email: '',
            password: '',
            confirmPassword: ''
        });
        setPasswordVisibility({
            password: false,
            confirmPassword: false
        });
    }, []);

    return {
        formData,
        passwordVisibility,
        updateField,
        togglePasswordVisibility,
        resetForm
    };
};

// Reusable components
const ValidationIndicator: React.FC<{ status: ValidationState['status']; colors: any; styles: any }> = React.memo(({ status, colors, styles }) => {
    if (status === 'validating') {
        return <ActivityIndicator size="small" color={colors.primary} style={styles.validationIndicator} />;
    }
    if (status === 'valid') {
        return <Ionicons name="checkmark-circle" size={22} color={colors.success} style={styles.validationIndicator} />;
    }
    if (status === 'invalid') {
        return <Ionicons name="close-circle" size={22} color={colors.error} style={styles.validationIndicator} />;
    }
    return null;
});

const ValidationMessage: React.FC<{ validationState: ValidationState; colors: any; styles: any }> = React.memo(({ validationState, colors, styles }) => {
    if (validationState.status === 'idle' || !validationState.message) return null;

    const isSuccess = validationState.status === 'valid';
    const backgroundColor = isSuccess ? colors.success + '10' : colors.error + '10';
    const borderColor = isSuccess ? colors.success + '30' : colors.error + '30';
    const iconColor = isSuccess ? colors.success : colors.error;
    const iconName = isSuccess ? 'checkmark-circle' : 'alert-circle';
    const title = isSuccess ? 'Username Available' : 'Username Taken';
    const subtitle = isSuccess ? 'Good choice! This username is available' : validationState.message;

    return (
        <View style={[styles.validationCard, { backgroundColor, borderColor }]}>
            <View style={[styles.validationIconContainer, { backgroundColor: iconColor + '20' }]}>
                <Ionicons name={iconName} size={16} color={iconColor} />
            </View>
            <View style={styles.validationTextContainer}>
                <Text style={[styles.validationTitle, { color: iconColor }]}>
                    {title}
                </Text>
                <Text style={[styles.validationSubtitle, { color: colors.secondaryText }]}>
                    {subtitle}
                </Text>
            </View>
        </View>
    );
});

const FormInput: React.FC<{
    icon: string;
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    secureTextEntry?: boolean;
    keyboardType?: 'default' | 'email-address';
    autoCapitalize?: 'none' | 'sentences';
    autoCorrect?: boolean;
    testID?: string;
    colors: any;
    styles: any;
    borderColor?: string;
    rightComponent?: React.ReactNode;
}> = React.memo(({
    icon,
    label,
    value,
    onChangeText,
    secureTextEntry = false,
    keyboardType = 'default',
    autoCapitalize = 'sentences',
    autoCorrect = true,
    testID,
    colors,
    styles,
    borderColor,
    rightComponent
}) => (
    <View style={styles.inputContainer}>
        <View style={[
            styles.premiumInputWrapper,
            {
                borderColor: borderColor || colors.border,
                backgroundColor: colors.inputBackground,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                elevation: 3,
            }
        ]}>
            <Ionicons
                name={icon as any}
                size={22}
                color={colors.secondaryText}
                style={styles.inputIcon}
            />
            <View style={styles.inputContent}>
                <Text style={[styles.modernLabel, { color: colors.secondaryText }]}>
                    {label}
                </Text>
                <TextInput
                    style={[styles.modernInput, { color: colors.text }]}
                    value={value}
                    onChangeText={onChangeText}
                    secureTextEntry={secureTextEntry}
                    keyboardType={keyboardType}
                    autoCapitalize={autoCapitalize}
                    autoCorrect={autoCorrect}
                    testID={testID}
                    placeholderTextColor="transparent"
                />
            </View>
            {rightComponent}
        </View>
    </View>
));

const ProgressIndicator: React.FC<{ currentStep: number; totalSteps: number; colors: any; styles: any }> = React.memo(({ currentStep, totalSteps, colors, styles }) => (
    <View style={styles.progressContainer}>
        {Array.from({ length: totalSteps }, (_, index) => (
            <View
                key={index}
                style={[
                    styles.progressDot,
                    currentStep === index ?
                        { backgroundColor: colors.primary, width: 24 } :
                        { backgroundColor: colors.border }
                ]}
            />
        ))}
    </View>
));

// Main component
const SignUpScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onAuthenticated,
    theme,
}) => {
    const { signUp, isLoading, user, isAuthenticated, oxyServices } = useOxy();
    const colors = useThemeColors(theme);

    // Form state
    const { formData, passwordVisibility, updateField, togglePasswordVisibility, resetForm } = useFormData();
    const { validationState, validateUsername, validateEmail, validatePassword, validatePasswordsMatch } = useFormValidation(oxyServices);

    // UI state
    const [currentStep, setCurrentStep] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');

    // Animation refs
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;

    // Memoized styles
    const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

    // Debounced username validation
    useEffect(() => {
        if (!formData.username || formData.username.length < USERNAME_MIN_LENGTH) {
            return;
        }

        const timeoutId = setTimeout(() => {
            validateUsername(formData.username);
        }, VALIDATION_DEBOUNCE_MS);

        return () => clearTimeout(timeoutId);
    }, [formData.username, validateUsername]);

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

    // Form validation helpers
    const isIdentityStepValid = useCallback(() => {
        return formData.username &&
            formData.email &&
            validateEmail(formData.email) &&
            validationState.status === 'valid';
    }, [formData.username, formData.email, validateEmail, validationState.status]);

    const isSecurityStepValid = useCallback(() => {
        return formData.password &&
            validatePassword(formData.password) &&
            validatePasswordsMatch(formData.password, formData.confirmPassword);
    }, [formData.password, formData.confirmPassword, validatePassword, validatePasswordsMatch]);

    // Custom next handlers for validation
    const handleIdentityNext = useCallback(() => {
        if (!isIdentityStepValid()) {
            toast.error('Please enter a valid username and email.');
            return;
        }
        nextStep();
    }, [isIdentityStepValid, nextStep]);

    const handleSecurityNext = useCallback(() => {
        if (!isSecurityStepValid()) {
            toast.error('Please enter a valid password and confirm it.');
            return;
        }
        nextStep();
    }, [isSecurityStepValid, nextStep]);

    // Sign up handler
    const handleSignUp = useCallback(async () => {
        if (!isIdentityStepValid() || !isSecurityStepValid()) {
            toast.error('Please fill in all fields correctly');
            return;
        }

        try {
            setErrorMessage('');
            const user = await signUp(formData.username, formData.email, formData.password);
            toast.success('Account created successfully! Welcome to Oxy!');

            if (onAuthenticated) {
                onAuthenticated(user);
            }

            resetForm();
        } catch (error: any) {
            toast.error(error.message || 'Sign up failed');
        }
    }, [formData, isIdentityStepValid, isSecurityStepValid, signUp, onAuthenticated, resetForm]);

    // Step components
    const renderWelcomeStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <HighFive width={100} height={100} />

            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    Welcome to Oxy
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    We're excited to have you join us. Let's get your account set up in just a few easy steps.
                </Text>
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Get Started',
                        onPress: nextStep,
                        icon: 'arrow-forward',
                        variant: 'primary',
                        testID: 'welcome-next-button',
                    },
                ]}
                colors={colors}
            />

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

    const renderIdentityStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Who are you?</Text>
            </View>

            <TextField
                icon="person-outline"
                label="Username"
                value={formData.username}
                onChangeText={(text) => {
                    updateField('username', text);
                    setErrorMessage('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                testID="username-input"
                colors={colors}
                variant="filled"
                error={validationState.status === 'invalid' ? validationState.message : undefined}
                loading={validationState.status === 'validating'}
                success={validationState.status === 'valid'}
            />

            <ValidationMessage validationState={validationState} colors={colors} styles={styles} />

            <TextField
                icon="mail-outline"
                label="Email"
                value={formData.email}
                onChangeText={(text) => {
                    updateField('email', text);
                }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                testID="email-input"
                colors={colors}
                variant="filled"
                error={formData.email && !validateEmail(formData.email) ? 'Please enter a valid email address' : undefined}
            />

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back',
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Next',
                        onPress: handleIdentityNext,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, formData, validationState, updateField, setErrorMessage, prevStep, handleIdentityNext, styles]);

    const renderSecurityStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Secure your account</Text>
            </View>

            <TextField
                icon="lock-closed-outline"
                label="Password"
                value={formData.password}
                onChangeText={(text) => {
                    updateField('password', text);
                }}
                secureTextEntry={!passwordVisibility.password}
                autoCapitalize="none"
                autoCorrect={false}
                testID="password-input"
                colors={colors}
                variant="filled"
                error={formData.password && !validatePassword(formData.password) ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters` : undefined}
            />

            <Text style={[styles.passwordHint, { color: colors.secondaryText }]}>Password must be at least {PASSWORD_MIN_LENGTH} characters long</Text>

            <TextField
                icon="lock-closed-outline"
                label="Confirm Password"
                value={formData.confirmPassword}
                onChangeText={(text) => {
                    updateField('confirmPassword', text);
                }}
                secureTextEntry={!passwordVisibility.confirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
                testID="confirm-password-input"
                colors={colors}
                variant="filled"
                error={formData.confirmPassword && !validatePasswordsMatch(formData.password, formData.confirmPassword) ? 'Passwords do not match' : undefined}
            />

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back',
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Next',
                        onPress: handleSecurityNext,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, formData, passwordVisibility, updateField, setErrorMessage, togglePasswordVisibility, prevStep, handleSecurityNext, styles]);

    const renderSummaryStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Ready to join</Text>
            </View>

            <View style={styles.summaryContainer}>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Username:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{formData.username}</Text>
                </View>

                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Email:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{formData.email}</Text>
                </View>
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back',
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Create Account',
                        onPress: handleSignUp,
                        icon: 'checkmark',
                        variant: 'primary',
                        disabled: isLoading,
                        loading: isLoading,
                        testID: 'signup-button',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, formData, isLoading, handleSignUp, prevStep, styles]);

    // If user is already authenticated, show user info
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

    // Render current step
    const renderCurrentStep = useCallback(() => {
        switch (currentStep) {
            case 0: return renderWelcomeStep();
            case 1: return renderIdentityStep();
            case 2: return renderSecurityStep();
            case 3: return renderSummaryStep();
            default: return renderWelcomeStep();
        }
    }, [currentStep, renderWelcomeStep, renderIdentityStep, renderSecurityStep, renderSummaryStep]);

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
                <ProgressIndicator currentStep={currentStep} totalSteps={4} colors={colors} styles={styles} />
                {renderCurrentStep()}
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

export default SignUpScreen;
