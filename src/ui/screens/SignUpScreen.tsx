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
import OxyLogo from '../components/OxyLogo';
import { BottomSheetScrollView, BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons'; // Add icon import
import Svg, { Path, Circle } from 'react-native-svg';
import { toast } from '../../lib/sonner';

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
            <BottomSheetScrollView style={[styles.scrollContainer, { backgroundColor, padding: 20 }]}>
                <Text style={[
                    styles.welcomeTitle,
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
            </BottomSheetScrollView>
        );
    }

    const validateEmail = (email: string) => {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    };

    const handleSignUp = async () => {
        // Validate inputs
        if (!username || !email || !password || !confirmPassword) {
            toast.error('Please fill in all fields');
            return;
        }

        if (!validateEmail(email)) {
            toast.error('Please enter a valid email address');
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
            await signUp(username, email, password);
            toast.success('Account created successfully! Welcome to Oxy!');
            // The authentication state change will be handled through context
        } catch (error: any) {
            toast.error(error.message || 'Sign up failed');
        }
    };

    // Step components
    const renderWelcomeStep = () => (
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
                        stroke="#d169e5"
                        strokeWidth="8"
                        fill="none"
                    />
                    <Circle cx="60" cy="60" r="18" fill="#d169e5" opacity="0.18" />
                    <Circle cx="110" cy="60" r="24" fill="#d169e5" opacity="0.25" />
                    <Circle cx="170" cy="50" r="14" fill="#d169e5" opacity="0.15" />
                    {/* Smiling face */}
                    <Circle cx="110" cy="60" r="32" fill="#fff" opacity="0.7" />
                    <Circle cx="100" cy="55" r="4" fill="#d169e5" />
                    <Circle cx="120" cy="55" r="4" fill="#d169e5" />
                    <Path
                        d="M104 68 Q110 75 116 68"
                        stroke="#d169e5"
                        strokeWidth="2"
                        fill="none"
                        strokeLinecap="round"
                    />
                </Svg>
            </View>

            <View style={styles.header}>
                {/* Add a close/back icon for better navigation */}
                <Text style={[styles.welcomeTitle]}>Create a Oxy Account</Text>
                <View style={styles.placeholder} />
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
        <BottomSheetScrollView
            contentContainerStyle={styles.scrollContainer}
            keyboardShouldPersistTaps="handled"
        >
            <OxyLogo
                style={{ marginBottom: 24 }}
                width={50}
                height={50}
            />

            <View style={styles.formContainer}>
                {renderCurrentStep()}
            </View>

            {currentStep > 0 && renderProgressIndicators()}
        </BottomSheetScrollView>
    );
};

const styles = StyleSheet.create({
    scrollContainer: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    placeholder: {
        width: 40,
    },
    formContainer: {
        width: '100%',
        marginTop: 8,
    },
    stepContainer: {
        width: '100%',
        paddingVertical: 8,
        paddingHorizontal: 0,
        marginBottom: 8,
    },
    inputContainer: {
        marginBottom: 18,
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
        backgroundColor: '#F5F5F5',
        borderColor: '#E0E0E0',
        marginBottom: 2,
    },
    button: {
        backgroundColor: '#d169e5',
        height: 48,
        borderRadius: 24,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 24,
        shadowColor: '#d169e5',
        shadowOpacity: 0.12,
        shadowOffset: { width: 0, height: 2 },
        shadowRadius: 8,
        elevation: 2,
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
        color: '#888',
    },
    linkText: {
        fontSize: 15,
        fontWeight: '700',
        color: '#d169e5',
    },
    errorContainer: {
        backgroundColor: '#FFE4EC',
        padding: 14,
        borderRadius: 18,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#F8BBD0',
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 15,
        fontWeight: '500',
    },
    userInfoContainer: {
        padding: 20,
        marginVertical: 20,
        backgroundColor: '#F5F5F5',
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
    // Multi-step form styles
    welcomeTitle: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 54,
        marginBottom: 24,
    },
    welcomeText: {
        fontSize: 16,
        textAlign: 'left',
        marginBottom: 30,
        lineHeight: 24,
        color: '#444',
    },
    welcomeImageContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        marginVertical: 30,
    },
    stepTitle: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 34,
        marginBottom: 20,
        color: '#d169e5',
        maxWidth: '90%',
    },
    navigationButtons: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 28,
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
        borderColor: '#E0E0E0',
    },
    nextButton: {
        minWidth: 100,
        backgroundColor: '#d169e5',
    },
    navButtonText: {
        fontSize: 16,
        fontWeight: '700',
        color: '#d169e5',
    },
    passwordHint: {
        fontSize: 12,
        marginTop: 4,
        color: '#888',
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
        backgroundColor: '#E0E0E0',
        borderWidth: 2,
        borderColor: '#fff',
        shadowColor: '#d169e5',
        shadowOpacity: 0.08,
        shadowOffset: { width: 0, height: 1 },
        shadowRadius: 2,
        elevation: 1,
    },
    summaryContainer: {
        padding: 0,
        marginBottom: 24,
    },
    summaryRow: {
        flexDirection: 'row',
        marginBottom: 10,
    },
    summaryLabel: {
        fontSize: 15,
        width: 90,
        color: '#888',
    },
    summaryValue: {
        fontSize: 15,
        fontWeight: '600',
        flex: 1,
        color: '#222',
    },
});

export default SignUpScreen;
