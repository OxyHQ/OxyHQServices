import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

interface SignUpSecurityStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: RouteName, props?: Record<string, any>) => void;

    // Step navigation
    nextStep: () => void;
    prevStep: () => void;
    currentStep: number;
    totalSteps: number;

    // Data management
    stepData?: any;
    updateStepData: (data: any) => void;

    // Form state
    password: string;
    confirmPassword: string;
    setPassword: (password: string) => void;
    setConfirmPassword: (confirmPassword: string) => void;
    showPassword: boolean;
    showConfirmPassword: boolean;
    setShowPassword: (show: boolean) => void;
    setShowConfirmPassword: (show: boolean) => void;
    setErrorMessage: (message: string) => void;

    // Validation
    validatePassword: (password: string) => boolean;
}

const SignUpSecurityStep: React.FC<SignUpSecurityStepProps> = ({
    colors,
    styles,
    nextStep,
    prevStep,
    password,
    confirmPassword,
    setPassword,
    setConfirmPassword,
    showPassword,
    showConfirmPassword,
    setShowPassword,
    setShowConfirmPassword,
    setErrorMessage,
    validatePassword,
}) => {
    const passwordRef = useRef<any>(null);
    const { t } = useI18n();
    const baseStyles = stepStyles;
    const webShadowReset = Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : null;

    const handlePasswordChange = (text: string) => {
        setPassword(text);
        setErrorMessage('');
    };

    const handleConfirmPasswordChange = (text: string) => {
        setConfirmPassword(text);
        setErrorMessage('');
    };

    const handleNext = () => {
        if (!password) {
            setErrorMessage('Please enter a password');
            setTimeout(() => passwordRef.current?.focus(), 0);
            return;
        }

        if (!validatePassword(password)) {
            setErrorMessage('Password must be at least 8 characters long');
            return;
        }

        if (!confirmPassword) {
            setErrorMessage('Please confirm your password');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage('Passwords do not match');
            return;
        }

        nextStep();
    };

    const passwordError = password && !validatePassword(password) ? 'Password must be at least 8 characters long' : undefined;
    const confirmPasswordError = confirmPassword && password !== confirmPassword ? 'Passwords do not match' : undefined;

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('signup.security.title')}</Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{t('signup.security.subtitle')}</Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                <View
                    style={[
                        stylesheet.formCard,
                        { backgroundColor: colors.inputBackground || colors.card || 'rgba(0,0,0,0.04)' },
                        webShadowReset,
                    ]}
                >
                    <TextField
                        ref={passwordRef}
                        label={t('common.labels.password')}
                        leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                        trailing={
                            <TouchableOpacity
                                onPress={() => setShowPassword(!showPassword)}
                                style={stylesheet.iconButton}
                            >
                                <Ionicons
                                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={20}
                                    color={colors.secondaryText}
                                />
                            </TouchableOpacity>
                        }
                        value={password}
                        onChangeText={handlePasswordChange}
                        secureTextEntry={!showPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="signup-password-input"
                        variant="filled"
                        error={passwordError}
                        onSubmitEditing={handleNext}
                        autoFocus
                        style={{ marginBottom: 0 }}
                    />

                    <TextField
                        label={t('common.labels.confirmPassword')}
                        leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                        trailing={
                            <TouchableOpacity
                                onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                                style={stylesheet.iconButton}
                            >
                                <Ionicons
                                    name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
                                    size={20}
                                    color={colors.secondaryText}
                                />
                            </TouchableOpacity>
                        }
                        value={confirmPassword}
                        onChangeText={handleConfirmPasswordChange}
                        secureTextEntry={!showConfirmPassword}
                        autoCapitalize="none"
                        autoCorrect={false}
                        testID="signup-confirm-password-input"
                        variant="filled"
                        error={confirmPasswordError}
                        onSubmitEditing={handleNext}
                        style={{ marginBottom: 0 }}
                    />

                    <Text style={[styles.footerText, stylesheet.helperText, { color: colors.secondaryText }]}>
                        Password must be at least 8 characters long
                    </Text>
                </View>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.buttonContainer]}>
                <GroupedPillButtons
                    buttons={[
                        {
                            text: t('common.actions.back'),
                            onPress: prevStep,
                            icon: 'arrow-back',
                            variant: 'transparent',
                        },
                        {
                            text: t('common.actions.next'),
                            onPress: handleNext,
                            icon: 'arrow-forward',
                            variant: 'primary',
                            disabled: !password || !confirmPassword || password !== confirmPassword,
                        },
                    ]}
                    colors={colors}
                />
            </View>
        </>
    );
};

export default SignUpSecurityStep;

const stylesheet = StyleSheet.create({
    formCard: {
        width: '100%',
        maxWidth: 420,
        borderRadius: 28,
        paddingHorizontal: 20,
        paddingVertical: 18,
        gap: STEP_INNER_GAP,
        alignItems: 'stretch',
        shadowColor: 'transparent',
    },
    iconButton: {
        padding: 4,
    },
    helperText: {
        fontSize: 12,
        marginTop: 0,
    },
});
