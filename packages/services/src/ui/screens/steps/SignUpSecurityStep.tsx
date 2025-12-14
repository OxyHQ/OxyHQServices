import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/TextField';
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
            setErrorMessage(t('signup.password.required') || 'Please enter a password');
            setTimeout(() => passwordRef.current?.focus(), 0);
            return;
        }

        if (!validatePassword(password)) {
            setErrorMessage(t('signup.password.minLength') || 'Password must be at least 8 characters long');
            return;
        }

        if (!confirmPassword) {
            setErrorMessage(t('signup.password.confirmRequired') || 'Please confirm your password');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMessage(t('signup.password.mismatch') || 'Passwords do not match');
            return;
        }

        nextStep();
    };

    const passwordError = password && !validatePassword(password) ? (t('signup.password.minLength') || 'Password must be at least 8 characters long') : undefined;
    const confirmPasswordError = confirmPassword && password !== confirmPassword ? (t('signup.password.mismatch') || 'Passwords do not match') : undefined;

    return (
        <>
            <View style={[baseStyles.container, { marginBottom: STEP_GAP }, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('signup.security.title')}</Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{t('signup.security.subtitle')}</Text>
            </View>

            <View style={[baseStyles.container, { marginBottom: STEP_GAP, gap: STEP_INNER_GAP }]}>
                <TextField
                    ref={passwordRef}
                    label={t('common.labels.password')}
                    leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                    right={<TextField.Icon icon={showPassword ? "eye-off" : "eye"} onPress={() => setShowPassword(!showPassword)} />}
                    value={password}
                    onChangeText={handlePasswordChange}
                    secureTextEntry={!showPassword}
                    passwordStrength={true}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="signup-password-input"
                    variant="filled"
                    error={passwordError}
                    helperText={t('signup.password.helper') || 'At least 8 characters'}
                    onSubmitEditing={handleNext}
                    autoFocus
                    accessibilityLabel={t('common.labels.password')}
                    accessibilityHint={t('signup.password.helper') || 'Enter a password, at least 8 characters long'}
                    style={{ marginBottom: 0 }}
                />

                <TextField
                    label={t('common.labels.confirmPassword')}
                    leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                    right={<TextField.Icon icon={showConfirmPassword ? "eye-off" : "eye"} onPress={() => setShowConfirmPassword(!showConfirmPassword)} />}
                    value={confirmPassword}
                    onChangeText={handleConfirmPasswordChange}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="signup-confirm-password-input"
                    variant="filled"
                    error={confirmPasswordError}
                    helperText={confirmPassword && password !== confirmPassword ? (t('signup.password.mismatch') || 'Passwords do not match') : undefined}
                    onSubmitEditing={handleNext}
                    accessibilityLabel={t('common.labels.confirmPassword')}
                    accessibilityHint={t('signup.password.confirmHint') || 'Re-enter your password to confirm'}
                    style={{ marginBottom: 0 }}
                />
            </View>

            <View style={[baseStyles.container, { marginBottom: 0 }, baseStyles.buttonContainer]}>
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
    helperText: {
        fontSize: 12,
        marginTop: 0,
    },
});
