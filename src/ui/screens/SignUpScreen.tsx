import React, { useState, useRef, useEffect } from 'react';
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
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';

const SignUpScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    theme,
}) => {
    // Form data states
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    // Multi-step form states
    const [currentStep, setCurrentStep] = useState(0);
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const heightAnim = useRef(new Animated.Value(400)).current; // Initial height value
    const [containerHeight, setContainerHeight] = useState(400); // Default height

    const { signUp, isLoading, user, isAuthenticated } = useOxy();

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const inputBackgroundColor = isDarkTheme ? '#333333' : '#F5F5F5';
    const placeholderColor = isDarkTheme ? '#AAAAAA' : '#999999';
    const primaryColor = '#d169e5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';

    // If user is already authenticated, show user info and account center option
    // Animation functions
    const animateTransition = (nextStep: number) => {
        // Fade out
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: true,
        }).start(() => {
            setCurrentStep(nextStep);

            // Reset slide position
            slideAnim.setValue(-100);

            // Fade in and slide
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
    };

    const nextStep = () => {
        if (currentStep < 3) {
            animateTransition(currentStep + 1);
        }
    };

    const prevStep = () => {
        if (currentStep > 0) {
            animateTransition(currentStep - 1);
        }
    };

    if (user && isAuthenticated) {
        return (
            <View style={[styles.container, { backgroundColor, padding: 20 }]}>
                <Text style={[
                    styles.title,
                    {
                        color: textColor,
                        textAlign: 'center'
                    }
                ]}>Welcome, {user.username}!</Text>

                <View style={styles.userInfoContainer}>
                    <Text style={[styles.userInfoText, { color: textColor }]}>
                        You are already signed in.
                    </Text>
                    {user.email && (
                        <Text style={[styles.userInfoText, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            Email: {user.email}
                        </Text>
                    )}
                </View>

                <View style={styles.actionButtonsContainer}>
                    <TouchableOpacity
                        style={[styles.button, { backgroundColor: primaryColor }]}
                        onPress={() => navigate('AccountCenter')}
                    >
                        <Text style={styles.buttonText}>Go to Account Center</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    const validateEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    const handleSignUp = async () => {
        // Validate inputs
        if (!username || !email || !password || !confirmPassword) {
            setErrorMessage('Please fill in all fields');
            return;
        }

        if (!validateEmail(email)) {
            setErrorMessage('Please enter a valid email address');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setErrorMessage('Password must be at least 8 characters long');
            return;
        }

        try {
            setErrorMessage('');
            await signUp(username, email, password);
            // The authentication state change will be handled through context
        } catch (error: any) {
            setErrorMessage(error.message || 'Sign up failed');
        }
    };

    // Step components
    const renderWelcomeStep = () => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <Text style={[styles.welcomeTitle, { color: textColor }]}>
                Welcome to OxyHQ
            </Text>

            <View style={styles.welcomeImageContainer}>
                {/* Placeholder for any welcome image or icon */}
                <View style={[styles.welcomeImagePlaceholder, { backgroundColor: isDarkTheme ? '#333' : '#f0f0f0' }]} />
            </View>

            <Text style={[styles.welcomeText, { color: textColor }]}>
                We're excited to have you join us. Let's get your account set up in just a few easy steps.
            </Text>

            <TouchableOpacity
                style={[styles.button, { backgroundColor: primaryColor }]}
                onPress={nextStep}
                testID="welcome-next-button"
            >
                <Text style={styles.buttonText}>Get Started</Text>
            </TouchableOpacity>

            <View style={styles.footerTextContainer}>
                <Text style={[styles.footerText, { color: textColor }]}>
                    Already have an account?{' '}
                </Text>
                <TouchableOpacity onPress={() => navigate('SignIn')}>
                    <Text style={[styles.linkText, { color: primaryColor }]}>Sign In</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderIdentityStep = () => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <Text style={[styles.stepTitle, { color: textColor }]}>Who are you?</Text>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Username</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Choose a username"
                    placeholderTextColor={placeholderColor}
                    value={username}
                    onChangeText={setUsername}
                    autoCapitalize="none"
                    testID="username-input"
                />
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Email</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Enter your email"
                    placeholderTextColor={placeholderColor}
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    testID="email-input"
                />
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton]}
                    onPress={prevStep}
                >
                    <Text style={[styles.navButtonText, { color: textColor }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, { backgroundColor: primaryColor }]}
                    onPress={nextStep}
                    disabled={!username || !email || !validateEmail(email)}
                >
                    <Text style={styles.navButtonText}>Next</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderSecurityStep = () => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <Text style={[styles.stepTitle, { color: textColor }]}>Secure your account</Text>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Password</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Create a password"
                    placeholderTextColor={placeholderColor}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry
                    testID="password-input"
                />
                <Text style={[styles.passwordHint, { color: isDarkTheme ? '#AAAAAA' : '#666666' }]}>
                    Password must be at least 8 characters long
                </Text>
            </View>

            <View style={styles.inputContainer}>
                <Text style={[styles.label, { color: textColor }]}>Confirm Password</Text>
                <TextInput
                    style={[
                        styles.input,
                        { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                    ]}
                    placeholder="Confirm your password"
                    placeholderTextColor={placeholderColor}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    testID="confirm-password-input"
                />
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton]}
                    onPress={prevStep}
                >
                    <Text style={[styles.navButtonText, { color: textColor }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, { backgroundColor: primaryColor }]}
                    onPress={nextStep}
                    disabled={!password || password.length < 8 || password !== confirmPassword}
                >
                    <Text style={styles.navButtonText}>Next</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderSummaryStep = () => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <Text style={[styles.stepTitle, { color: textColor }]}>Ready to join</Text>

            <View style={styles.summaryContainer}>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: isDarkTheme ? '#AAAAAA' : '#666666' }]}>Username:</Text>
                    <Text style={[styles.summaryValue, { color: textColor }]}>{username}</Text>
                </View>

                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: isDarkTheme ? '#AAAAAA' : '#666666' }]}>Email:</Text>
                    <Text style={[styles.summaryValue, { color: textColor }]}>{email}</Text>
                </View>
            </View>

            {errorMessage ? (
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
            ) : null}

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton]}
                    onPress={prevStep}
                >
                    <Text style={[styles.navButtonText, { color: textColor }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.button, { opacity: isLoading ? 0.8 : 1 }]}
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
            </View>
        </Animated.View>
    );

    // Progress indicators
    const renderProgressIndicators = () => (
        <View style={styles.progressContainer}>
            {[0, 1, 2, 3].map((step) => (
                <View
                    key={step}
                    style={[
                        styles.progressDot,
                        currentStep === step ?
                            { backgroundColor: primaryColor, width: 24 } :
                            { backgroundColor: isDarkTheme ? '#444444' : '#E0E0E0' }
                    ]}
                />
            ))}
        </View>
    );

    // Render step based on current step value
    const renderCurrentStep = () => {
        switch (currentStep) {
            case 0:
                return renderWelcomeStep();
            case 1:
                return renderIdentityStep();
            case 2:
                return renderSecurityStep();
            case 3:
                return renderSummaryStep();
            default:
                return null;
        }
    };

    return (
        <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            style={[styles.container, { backgroundColor }]}
        >
            <ScrollView
                contentContainerStyle={styles.scrollContainer}
                keyboardShouldPersistTaps="handled"
            >
                <View style={styles.header}>
                    <Text style={[styles.title]}>Create Account</Text>
                    <View style={styles.placeholder} />
                </View>

                {currentStep > 0 && renderProgressIndicators()}

                <View style={styles.formContainer}>
                    {renderCurrentStep()}
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContainer: {
        flexGrow: 1,
        padding: 10,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 54,
    },
    placeholder: {
        width: 50, // To balance the header
    },
    formContainer: {
        width: '100%',
    },
    stepContainer: {
        width: '100%',
        paddingVertical: 20,
    },
    inputContainer: {
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        marginBottom: 8,
    },
    input: {
        height: 48,
        borderRadius: 35,
        paddingHorizontal: 16,
        borderWidth: 1,
        fontSize: 16,
    },
    button: {
        backgroundColor: '#d169e5',
        height: 48,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 24,
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    footerTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
    footerText: {
        fontSize: 14,
    },
    linkText: {
        fontSize: 14,
        fontWeight: '600',
    },
    errorContainer: {
        backgroundColor: '#FFEBEE',
        padding: 12,
        borderRadius: 35,
        marginBottom: 16,
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 14,
    },
    userInfoContainer: {
        padding: 20,
        marginVertical: 20,
        backgroundColor: '#F5F5F5',
        borderRadius: 35,
        alignItems: 'center',
    },
    userInfoText: {
        fontSize: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    actionButtonsContainer: {
        marginTop: 24,
    },
    // Multi-step form styles
    welcomeTitle: {
        fontSize: 32,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 20,
    },
    welcomeText: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 30,
        lineHeight: 24,
    },
    welcomeImageContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 30,
    },
    welcomeImagePlaceholder: {
        width: 120,
        height: 120,
        borderRadius: 60,
    },
    stepTitle: {
        fontSize: 24,
        fontWeight: '600',
        marginBottom: 20,
    },
    navigationButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 24,
    },
    navButton: {
        borderRadius: 35,
        height: 48,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
    },
    backButton: {
        backgroundColor: 'transparent',
    },
    nextButton: {
        minWidth: 100,
    },
    navButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: '#FFFFFF',
    },
    passwordHint: {
        fontSize: 12,
        marginTop: 4,
    },
    progressContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 20,
    },
    progressDot: {
        height: 8,
        width: 8,
        borderRadius: 4,
        marginHorizontal: 4,
    },
    summaryContainer: {
        backgroundColor: '#F5F5F5',
        borderRadius: 15,
        padding: 16,
        marginBottom: 24,
    },
    summaryRow: {
        flexDirection: 'row',
        marginBottom: 10,
    },
    summaryLabel: {
        fontSize: 14,
        width: 80,
    },
    summaryValue: {
        fontSize: 14,
        fontWeight: '500',
        flex: 1,
    },
});

export default SignUpScreen;
