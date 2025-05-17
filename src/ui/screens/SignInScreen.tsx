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
import { fontFamilies, useThemeColors, createCommonStyles } from '../styles';

const SignInScreen: React.FC<BaseScreenProps> = ({
    navigate,
    theme,
}) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const { login, isLoading, user, isAuthenticated } = useOxy();

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);

    // If user is already authenticated, show user info instead of login form
    if (user && isAuthenticated) {
        return (
            <View style={[commonStyles.container, { padding: 20 }]}>
                <Text style={[
                    styles.title,
                    { color: colors.text }
                ]}>Welcome, {user.username}!</Text>

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
                        style={[commonStyles.button, { backgroundColor: colors.primary }]}
                        onPress={() => navigate('AccountCenter')}
                    >
                        <Text style={commonStyles.buttonText}>Go to Account Center</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

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
            style={[commonStyles.container]}
        >
            <ScrollView
                contentContainerStyle={commonStyles.scrollContainer}
                keyboardShouldPersistTaps="handled"
            >
                <Text style={[
                    styles.title,
                    { color: colors.text }
                ]}>Sign In</Text>

                {errorMessage ? (
                    <View style={commonStyles.errorContainer}>
                        <Text style={commonStyles.errorText}>{errorMessage}</Text>
                    </View>
                ) : null}

                <View style={styles.formContainer}>
                    <View style={styles.inputContainer}>
                        <Text style={[styles.label, { color: colors.text }]}>Username</Text>
                        <TextInput
                            style={commonStyles.input}
                            placeholder="Enter your username"
                            placeholderTextColor={colors.placeholder}
                            value={username}
                            onChangeText={setUsername}
                            autoCapitalize="none"
                            testID="username-input"
                        />
                    </View>

                    <View style={styles.inputContainer}>
                        <Text style={[styles.label, { color: colors.text }]}>Password</Text>
                        <TextInput
                            style={commonStyles.input}
                            placeholder="Enter your password"
                            placeholderTextColor={colors.placeholder}
                            value={password}
                            onChangeText={setPassword}
                            secureTextEntry
                            testID="password-input"
                        />
                    </View>

                    <TouchableOpacity
                        style={[commonStyles.button, { opacity: isLoading ? 0.8 : 1 }]}
                        onPress={handleLogin}
                        disabled={isLoading}
                        testID="login-button"
                    >
                        {isLoading ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <Text style={commonStyles.buttonText}>Sign In</Text>
                        )}
                    </TouchableOpacity>

                    <View style={styles.footerTextContainer}>
                        <Text style={[styles.footerText, { color: colors.text }]}>
                            Don't have an account?{' '}
                        </Text>
                        <TouchableOpacity onPress={() => navigate('SignUp')}>
                            <Text style={[styles.linkText, { color: colors.primary }]}>Sign Up</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    // Local screen-specific styles
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 34,
        marginBottom: 24,
        textAlign: 'left',
    },
    formContainer: {
        width: '100%',
    },
    inputContainer: {
        marginBottom: 16,
    },
    label: {
        fontSize: 14,
        fontWeight: '500' as TextStyle['fontWeight'],
        marginBottom: 8,
    },
    footerTextContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 24,
    },
    footerText: {
        fontSize: 14,
        lineHeight: 20,
    },
    linkText: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '600',
    },
    // New styles for authenticated user view
    userInfoContainer: {
        padding: 20,
        marginVertical: 20,
        borderRadius: 35,
        alignItems: 'center',
    },
    userInfoText: {
        fontSize: 16,
        lineHeight: 24,
        textAlign: 'center',
    },
    actionButtonsContainer: {
        marginTop: 20,
    },
});

export default SignInScreen;
