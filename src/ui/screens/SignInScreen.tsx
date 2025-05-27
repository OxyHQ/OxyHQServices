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
import OxyLogo from '../components/OxyLogo';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';

const SignInScreen: React.FC<BaseScreenProps> = ({
    navigate,
    theme,
}) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    const { login, isLoading, user, isAuthenticated, sessions } = useOxy();

    const colors = useThemeColors(theme);
    const commonStyles = createCommonStyles(theme);

    // Check if this should be treated as "Add Account" mode
    const isAddAccountMode = user && isAuthenticated && sessions && sessions.length > 0;

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
        <BottomSheetScrollView
            contentContainerStyle={commonStyles.scrollContainer}
            keyboardShouldPersistTaps="handled"
        >
            <OxyLogo
                style={{ marginBottom: 24 }}
                width={50}
                height={50}
            />
            <Text style={[
                styles.title,
                { color: colors.text }
            ]}>{isAddAccountMode ? 'Add Another Account' : 'Sign In'}</Text>

            {isAddAccountMode && (
                <View style={[styles.infoContainer, { backgroundColor: colors.inputBackground }]}>
                    <Text style={[styles.infoText, { color: colors.secondaryText }]}>
                        Currently signed in as {user?.username}. Sign in with another account to add it to this device.
                    </Text>
                </View>
            )}

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
                        <Text style={commonStyles.buttonText}>
                            {isAddAccountMode ? 'Add Account' : 'Sign In'}
                        </Text>
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
        </BottomSheetScrollView>
    );
};

const styles = StyleSheet.create({
    title: {
        fontFamily: Platform.OS === 'web'
            ? 'Phudu'  // Use CSS font name directly for web
            : 'Phudu-Bold',  // Use exact font name as registered with Font.loadAsync
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,  // Only apply fontWeight on web
        fontSize: 54,
        marginBottom: 24,
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
    infoContainer: {
        padding: 16,
        marginVertical: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    infoText: {
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
});

export default SignInScreen;
