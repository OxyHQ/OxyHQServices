import type React from 'react';
import { useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';

interface SignUpSecurityStepProps {
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
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    Secure Your Account
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Create a strong password to protect your account
                </Text>
            </View>

            <View style={styles.modernInputContainer}>
                <TextField
                    ref={passwordRef}
                    label="Password"
                    leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                    trailing={
                        <TouchableOpacity
                            onPress={() => setShowPassword(!showPassword)}
                            style={{ padding: 4 }}
                        >
                            <Ionicons
                                name={showPassword ? "eye-off-outline" : "eye-outline"}
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
                />

                <TextField
                    label="Confirm Password"
                    leading={<Ionicons name="lock-closed-outline" size={24} color={colors.secondaryText} />}
                    trailing={
                        <TouchableOpacity
                            onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                            style={{ padding: 4 }}
                        >
                            <Ionicons
                                name={showConfirmPassword ? "eye-off-outline" : "eye-outline"}
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
                />

                <View style={{ marginTop: 16 }}>
                    <Text style={[styles.footerText, { color: colors.secondaryText, fontSize: 12 }]}>
                        Password must be at least 8 characters long
                    </Text>
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
                        text: 'Next',
                        onPress: handleNext,
                        icon: 'arrow-forward',
                        variant: 'primary',
                        disabled: !password || !confirmPassword || password !== confirmPassword,
                    },
                ]}
                colors={colors}
            />
        </>
    );
};

export default SignUpSecurityStep;
