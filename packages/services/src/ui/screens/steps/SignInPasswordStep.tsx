import type React from 'react';
import { useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, Platform, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../../components/Avatar';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import { useI18n } from '../../hooks/useI18n';
import { useOxy } from '../../context/OxyContext';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

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
    mfaToken?: string | null;
    existingSession?: any;
    handleContinueWithExistingAccount?: () => Promise<void>;
}

const SignInPasswordStep: React.FC<SignInPasswordStepProps> = ({
    colors,
    styles,
    theme,
    navigate,
    nextStep,
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
    mfaToken,
    existingSession,
    handleContinueWithExistingAccount,
}) => {
    const inputRef = useRef<any>(null);
    const { t } = useI18n();
    const { oxyServices } = useOxy();
    const baseStyles = stepStyles;
    const webShadowReset = Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : null;

    const handlePasswordChange = (text: string) => {
        setPassword(text);
        if (errorMessage) setErrorMessage('');
    };

    const handleSignInSubmit = async () => {
        if (!password) {
            setErrorMessage(t('signin.password.required') || 'Please enter your password.');
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

    // Auto-advance when MFA is required
    useEffect(() => {
        if (mfaToken) {
            // Move to TOTP step when token is available
            nextStep();
        }
    }, [mfaToken, nextStep]);

    // If account is already signed in, show "continue" UI instead of password
    if (existingSession && handleContinueWithExistingAccount) {
        return (
            <>
                <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.userProfileContainer]}>
                        <Avatar
                            name={userProfile?.displayName || userProfile?.name || username}
                            size={100}
                            
                            backgroundColor={colors.primary + '20'}
                        uri={userProfile?.avatar && oxyServices ? oxyServices.getFileDownloadUrl(userProfile.avatar, 'thumb') : undefined}
                        />
                    <Text style={[styles.modernUserDisplayName, stylesheet.displayName, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>
                        {userProfile?.displayName || userProfile?.name || username}
                    </Text>
                    <Text style={[styles.modernUsernameSubtext, stylesheet.usernameSubtext, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>
                        @{username}
                    </Text>
                </View>

                <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.alreadySignedInContainer]}>
                    <View style={[stylesheet.alreadySignedInCard, { backgroundColor: `${colors.primary}08`, borderColor: `${colors.primary}25` }]}>
                        <View style={stylesheet.alreadySignedInContent}>
                            <View style={[stylesheet.alreadySignedInIconWrapper, { backgroundColor: `${colors.primary}20` }]}>
                                <Ionicons name="checkmark-circle" size={28} color={colors.primary} />
                            </View>
                            <View style={stylesheet.alreadySignedInTextWrapper}>
                                <Text style={[stylesheet.alreadySignedInTitle, { color: colors.text }]}>
                                    {t('signin.alreadySignedIn') || 'Already signed in'}
                                </Text>
                                <Text style={[stylesheet.alreadySignedInMessage, { color: colors.secondaryText }]}>
                                    {t('signin.alreadySignedInMessage') || 'This account is already signed in. Tap continue to use it.'}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {errorMessage && (
                    <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                        <Text style={[stylesheet.errorText, { color: colors.error }]}>
                            {errorMessage}
                        </Text>
                    </View>
                )}

                <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.buttonContainer]}>
                    <GroupedPillButtons
                        buttons={[
                            {
                                text: t('common.actions.back') || 'Back',
                                onPress: prevStep,
                                icon: 'arrow-back',
                                variant: 'transparent',
                            },
                            {
                                text: t('signin.continueWithAccount') || 'Continue',
                                onPress: handleContinueWithExistingAccount,
                                icon: 'log-in',
                                variant: 'primary',
                                loading: isLoading,
                                testID: 'continue-button',
                            },
                        ]}
                        colors={colors}
                    />
                </View>
            </>
        );
    }

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.userProfileContainer]}>
                    <Avatar
                        name={userProfile?.displayName || userProfile?.name || username}
                        size={100}
                        
                        backgroundColor={colors.primary + '20'}
                    uri={userProfile?.avatar && oxyServices ? oxyServices.getFileDownloadUrl(userProfile.avatar, 'thumb') : undefined}
                    />
                <Text style={[styles.modernUserDisplayName, stylesheet.displayName, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>
                    {userProfile?.displayName || userProfile?.name || username}
                </Text>
                <Text style={[styles.modernUsernameSubtext, stylesheet.usernameSubtext, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>
                    @{username}
                </Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.inputSection]}>
                <TextField
                    ref={inputRef}
                    label={t('common.labels.password')}
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
                    accessibilityLabel={t('common.labels.password')}
                    accessibilityHint={t('signin.password.hint') || 'Enter your password to sign in'}
                    style={{ marginBottom: 0 }}
                />

                <View style={[stylesheet.forgotPasswordContainer]}>
                    <Text style={[styles.footerText, { color: colors.text }]}>{t('signin.forgotPrompt') || 'Forgot your password?'} </Text>
                    <TouchableOpacity onPress={() => navigate('RecoverAccount', {
                        returnTo: 'SignIn',
                        returnStep: 1,
                        returnData: { username, userProfile }
                    })}>
                        <Text style={[styles.modernLinkText, { color: colors.primary }]}>{t('common.links.recoverAccount')}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.buttonContainer]}>
                <GroupedPillButtons
                    buttons={[
                        {
                            text: t('common.actions.back') || 'Back',
                            onPress: prevStep,
                            icon: 'arrow-back',
                            variant: 'transparent',
                        },
                        {
                            text: t('common.actions.signIn') || 'Sign In',
                            onPress: handleSignInSubmit,
                            icon: 'log-in',
                            variant: 'primary',
                            loading: isLoading,
                            testID: 'login-button',
                        },
                    ]}
                    colors={colors}
                />
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.securityNotice, { marginTop: 0 }]}>
                <Ionicons name="shield-checkmark" size={14} color={colors.secondaryText} />
                <Text style={[styles.securityText, { color: colors.secondaryText }]}>
                    {t('signin.security.dataSecure') || 'Your data is encrypted and secure'}
                </Text>
            </View>
        </>
    );
};

export default SignInPasswordStep;

const stylesheet = StyleSheet.create({
    userProfileContainer: {
        alignItems: 'flex-start',
        paddingVertical: 0,
        gap: STEP_INNER_GAP,
    },
    avatarContainer: {
        position: 'relative',
        marginBottom: 0,
        marginTop: 0,
    },
    displayName: {
        marginBottom: 0,
        marginTop: 0,
    },
    usernameSubtext: {
        marginBottom: 0,
        marginTop: 0,
    },
    inputSection: {
        gap: STEP_INNER_GAP,
    },
    forgotPasswordContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 0,
    },
    securityNotice: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: STEP_INNER_GAP,
    },
    alreadySignedInContainer: {
        width: '100%',
    },
    alreadySignedInCard: {
        borderRadius: 20,
        borderWidth: 1.5,
        padding: 20,
        width: '100%',
    },
    alreadySignedInContent: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 16,
    },
    alreadySignedInIconWrapper: {
        width: 52,
        height: 52,
        borderRadius: 26,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    alreadySignedInTextWrapper: {
        flex: 1,
        gap: 8,
        paddingTop: 2,
    },
    alreadySignedInTitle: {
        fontSize: 18,
        fontWeight: '600',
        lineHeight: 24,
        letterSpacing: -0.2,
    },
    alreadySignedInMessage: {
        fontSize: 15,
        lineHeight: 22,
        letterSpacing: -0.1,
    },
    errorText: {
        fontSize: 14,
        textAlign: 'center',
    },
});
