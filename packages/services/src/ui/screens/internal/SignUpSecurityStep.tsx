import React, { useRef, useCallback, useEffect } from 'react';
import { View, Text, Animated, TextInput } from 'react-native';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';

interface SignUpSecurityStepProps {
    styles: any;
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    colors: any;
    formData: any;
    passwordVisibility: { password: boolean; confirmPassword: boolean };
    updateField: (field: string, value: string) => void;
    validatePassword: (password: string) => boolean;
    validatePasswordsMatch: (password: string, confirmPassword: string) => boolean;
    prevStep: () => void;
    handleSecurityNext: () => void;
    setErrorMessage: (msg: string) => void;
    togglePasswordVisibility: () => void;
    PASSWORD_MIN_LENGTH: number;
}

const SignUpSecurityStep: React.FC<SignUpSecurityStepProps> = ({
    styles,
    fadeAnim,
    slideAnim,
    colors,
    formData,
    passwordVisibility,
    updateField,
    validatePassword,
    validatePasswordsMatch,
    prevStep,
    handleSecurityNext: parentHandleSecurityNext,
    setErrorMessage,
    togglePasswordVisibility,
    PASSWORD_MIN_LENGTH,
}) => {
    const passwordRef = useRef<TextInput>(null);
    const confirmPasswordRef = useRef<TextInput>(null);

    // Focus the first invalid field on error or when step becomes active
    useEffect(() => {
        if (formData.password && typeof formData.password === 'string' && !validatePassword(formData.password)) {
            setTimeout(() => {
                passwordRef.current?.focus();
            }, 0);
        } else if (formData.confirmPassword && typeof formData.confirmPassword === 'string' && !validatePasswordsMatch(formData.password, formData.confirmPassword)) {
            setTimeout(() => {
                confirmPasswordRef.current?.focus();
            }, 0);
        }
    }, [formData.password, formData.confirmPassword, validatePassword, validatePasswordsMatch]);

    const handleSecurityNext = useCallback(() => {
        if (!formData.password || !validatePassword(formData.password)) {
            setTimeout(() => {
                passwordRef.current?.focus();
            }, 0);
            return;
        }
        if (!formData.confirmPassword || !validatePasswordsMatch(formData.password, formData.confirmPassword)) {
            setTimeout(() => {
                confirmPasswordRef.current?.focus();
            }, 0);
            return;
        }
        parentHandleSecurityNext();
    }, [formData.password, formData.confirmPassword, validatePassword, validatePasswordsMatch, parentHandleSecurityNext]);

    return (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>Secure your account</Text>
            </View>
            <TextField
                ref={passwordRef}
                icon="lock-closed-outline"
                label="Password"
                value={formData.password}
                onChangeText={text => updateField('password', text)}
                secureTextEntry={!passwordVisibility.password}
                autoCapitalize="none"
                autoCorrect={false}
                testID="password-input"
                colors={colors}
                variant="filled"
                error={formData.password && typeof formData.password === 'string' && !validatePassword(formData.password) ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters` : undefined}
                onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                autoFocus
            />
            <Text style={[styles.passwordHint, { color: colors.secondaryText }]}>Password must be at least {PASSWORD_MIN_LENGTH} characters long</Text>
            <TextField
                ref={confirmPasswordRef}
                icon="lock-closed-outline"
                label="Confirm Password"
                value={formData.confirmPassword}
                onChangeText={text => updateField('confirmPassword', text)}
                secureTextEntry={!passwordVisibility.confirmPassword}
                autoCapitalize="none"
                autoCorrect={false}
                testID="confirm-password-input"
                colors={colors}
                variant="filled"
                error={formData.confirmPassword && typeof formData.confirmPassword === 'string' && !validatePasswordsMatch(formData.password, formData.confirmPassword) ? 'Passwords do not match' : undefined}
                onSubmitEditing={handleSecurityNext}
            />
            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back',
                        onPress: prevStep,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Next',
                        onPress: handleSecurityNext,
                        icon: 'arrow-forward',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </Animated.View>
    );
};

export default SignUpSecurityStep; 