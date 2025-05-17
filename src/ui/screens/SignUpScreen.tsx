import React, { useState } from 'react';
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
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';

const SignUpScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    theme,
}) => {
    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const { signUp, isLoading, user, isAuthenticated } = useOxy();

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const inputBackgroundColor = isDarkTheme ? '#333333' : '#F5F5F5';
    const placeholderColor = isDarkTheme ? '#AAAAAA' : '#999999';
    const primaryColor = '#d169e5';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';

    // If user is already authenticated, show user info and account center option
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
                    <TouchableOpacity onPress={goBack} style={styles.backButton}>
                        <Text style={[styles.backButtonText, { color: primaryColor }]}>Back</Text>
                    </TouchableOpacity>
                    <Text style={[
                        styles.title,
                        {
                            color: textColor,
                            textAlign: 'center'
                        }
                    ]}>Create Account</Text>
                    <View style={styles.placeholder} />
                </View>

                {errorMessage ? (
                    <View style={styles.errorContainer}>
                        <Text style={styles.errorText}>{errorMessage}</Text>
                    </View>
                ) : null}

                <View style={styles.formContainer}>
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

                    <View style={styles.footerTextContainer}>
                        <Text style={[styles.footerText, { color: textColor }]}>
                            Already have an account?{' '}
                        </Text>
                        <TouchableOpacity onPress={() => navigate('SignIn')}>
                            <Text style={[styles.linkText, { color: primaryColor }]}>Sign In</Text>
                        </TouchableOpacity>
                    </View>
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
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    backButton: {
        paddingVertical: 8,
        paddingHorizontal: 4,
    },
    backButtonText: {
        fontSize: 16,
    },
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 24,
        textAlign: 'center',
    },
    placeholder: {
        width: 50, // To balance the header
    },
    formContainer: {
        width: '100%',
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
});

export default SignUpScreen;
