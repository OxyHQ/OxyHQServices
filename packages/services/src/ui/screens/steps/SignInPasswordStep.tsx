import type React from 'react';
import { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/Avatar';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';

interface SignInPasswordStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: string, props?: Record<string, any>) => void;

    // Step navigation
    nextStep: () => void;
    prevStep: () => void;
    currentStep: number;
    totalSteps: number;

    // Data management
    stepData?: any;
    updateStepData: (data: any) => void;
    allStepData: any[];

    // Form state
    password: string;
    setPassword: (password: string) => void;
    showPassword: boolean;
    setShowPassword: (show: boolean) => void;
    errorMessage: string;
    setErrorMessage: (message: string) => void;
    isLoading: boolean;

    // User profile
    userProfile: any;
    username: string;

    // Sign-in function
    handleSignIn: () => Promise<void>;
}

const SignInPasswordStep: React.FC<SignInPasswordStepProps> = ({
    colors,
    styles,
    theme,
    navigate,
    prevStep,
    password,
    setPassword,
    showPassword,
    setShowPassword,
    errorMessage,
    setErrorMessage,
    isLoading,
    userProfile,
    username,
    handleSignIn,
}) => {
    const inputRef = useRef<any>(null);

    const handlePasswordChange = (text: string) => {
        setPassword(text);
        if (errorMessage) setErrorMessage('');
    };

    const handleSignInSubmit = async () => {
        if (!password) {
            setErrorMessage('Please enter your password.');
            setTimeout(() => inputRef.current?.focus(), 0);
            return;
        }

        // Call the actual sign-in function passed from props
        await handleSignIn();
    };

    const togglePasswordVisibility = () => {
        setShowPassword(!showPassword);
    };

    // Focus password input on error
    useEffect(() => {
        if (errorMessage) {
            setTimeout(() => {
                inputRef.current?.focus();
            }, 0);
        }
    }, [errorMessage]);

    return (
        <>
            <View style={styles.modernUserProfileContainer}>
                <View style={styles.avatarContainer}>
                    <Avatar
                        name={userProfile?.displayName || userProfile?.name || username}
                        size={100}
                        theme={theme as 'light' | 'dark'}
                        style={styles.modernUserAvatar}
                        backgroundColor={colors.primary + '20'}
                    />
                    <View style={[styles.statusIndicator, { backgroundColor: colors.primary }]} />
                </View>
                <Text style={[styles.modernUserDisplayName, { color: colors.text }]}>
                    {userProfile?.displayName || userProfile?.name || username}
                </Text>
                <Text style={[styles.modernUsernameSubtext, { color: colors.secondaryText }]}>
                    @{username}
                </Text>
            </View>

            <View style={styles.modernInputContainer}>
                <TextField
                    ref={inputRef}
                    label="Password"
                    leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                    value={password}
                    onChangeText={handlePasswordChange}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="password-input"
                    variant="filled"
                    error={errorMessage || undefined}
                    onSubmitEditing={handleSignInSubmit}
                    autoFocus
                />

                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                    <Text style={[styles.footerText, { color: colors.text }]}>Forgot your password? </Text>
                    <TouchableOpacity onPress={() => navigate('RecoverAccount', {
                        returnTo: 'SignIn',
                        returnStep: 1,
                        returnData: { username, userProfile }
                    })}>
                        <Text style={[styles.modernLinkText, { color: colors.primary }]}>Recover your account</Text>
                    </TouchableOpacity>
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
                        text: 'Sign In',
                        onPress: handleSignInSubmit,
                        icon: 'log-in',
                        variant: 'primary',
                        loading: isLoading,
                        testID: 'login-button',
                    },
                ]}
                colors={colors}
            />

            <View style={styles.securityNotice}>
                <Ionicons name="shield-checkmark" size={14} color={colors.secondaryText} />
                <Text style={[styles.securityText, { color: colors.secondaryText }]}>
                    Your data is encrypted and secure
                </Text>
            </View>
        </>
    );
};

export default SignInPasswordStep;
