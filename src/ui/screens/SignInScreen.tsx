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
} from 'react-native';
import { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';

const SignInScreen: React.FC<BaseScreenProps> = ({
    navigate,
    theme,
}) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const { login, isLoading } = useOxy();

    const isDarkTheme = theme === 'dark';
    const textColor = isDarkTheme ? '#FFFFFF' : '#000000';
    const backgroundColor = isDarkTheme ? '#121212' : '#FFFFFF';
    const inputBackgroundColor = isDarkTheme ? '#333333' : '#F5F5F5';
    const placeholderColor = isDarkTheme ? '#AAAAAA' : '#999999';
    const primaryColor = '#0066CC';
    const borderColor = isDarkTheme ? '#444444' : '#E0E0E0';

    const handleLogin = async () => {
        if (!username || !password) {
            setErrorMessage('Please enter both username and password');
            return;
        }

        try {
            setErrorMessage('');
            await login(username, password);
            // The authentication state change will be handled through context
        } catch (error: any) {
            setErrorMessage(error.message || 'Login failed');
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
                <Text style={[styles.title, { color: textColor }]}>Sign In</Text>

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
                            placeholder="Enter your username"
                            placeholderTextColor={placeholderColor}
                            value={username}
                            onChangeText={setUsername}
                            autoCapitalize="none"
                            testID="username-input"
                        />
                    </View>

                    <View style={styles.inputContainer}>
                        <Text style={[styles.label, { color: textColor }]}>Password</Text>
                        <TextInput
                            style={[
                                styles.input,
                                { backgroundColor: inputBackgroundColor, borderColor, color: textColor }
                            ]}
                            placeholder="Enter your password"
                            placeholderTextColor={placeholderColor}
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                            testID="password-input"
                        />
                    </View>

                    <TouchableOpacity
                        style={[styles.button, { opacity: isLoading ? 0.8 : 1 }]}
                        onPress={handleLogin}
                        disabled={isLoading}
                        testID="login-button"
                    >
                        {isLoading ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <Text style={styles.buttonText}>Sign In</Text>
                        )}
                    </TouchableOpacity>

                    <View style={styles.footerTextContainer}>
                        <Text style={[styles.footerText, { color: textColor }]}>
                            Don't have an account?{' '}
                        </Text>
                        <TouchableOpacity onPress={() => navigate('SignUp')}>
                            <Text style={[styles.linkText, { color: primaryColor }]}>Sign Up</Text>
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
    title: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 24,
        textAlign: 'center',
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
        borderRadius: 8,
        paddingHorizontal: 16,
        borderWidth: 1,
        fontSize: 16,
    },
    button: {
        backgroundColor: '#0066CC',
        height: 48,
        borderRadius: 8,
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
        borderRadius: 8,
        marginBottom: 16,
    },
    errorText: {
        color: '#D32F2F',
        fontSize: 14,
    },
});

export default SignInScreen;
