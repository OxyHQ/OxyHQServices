import React from 'react';
import { View, Text, Animated } from 'react-native';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';

interface SignUpSecurityStepProps {
    styles: any;
    fadeAnim: Animated.Value;
    slideAnim: Animated.Value;
    colors: any;
    formData: any;
    passwordVisibility: boolean;
    updateField: (field: string, value: string) => void;
    validatePassword: (password: string) => boolean;
    validatePasswordsMatch: () => boolean;
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
    handleSecurityNext,
    setErrorMessage,
    togglePasswordVisibility,
    PASSWORD_MIN_LENGTH,
}) => (
    <Animated.View style={[
        styles.stepContainer,
        { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
    ]}>
        <View style={styles.modernHeader}>
            <Text style={[styles.stepTitle, { color: colors.text }]}>Secure your account</Text>
        </View>
        <TextField
            icon="lock-closed-outline"
            label="Password"
            value={formData.password}
            onChangeText={(text) => {
                updateField('password', text);
            }}
            secureTextEntry={!passwordVisibility.password}
            autoCapitalize="none"
            autoCorrect={false}
            testID="password-input"
            colors={colors}
            variant="filled"
            error={formData.password && !validatePassword(formData.password) ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters` : undefined}
        />
        <Text style={[styles.passwordHint, { color: colors.secondaryText }]}>Password must be at least {PASSWORD_MIN_LENGTH} characters long</Text>
        <TextField
            icon="lock-closed-outline"
            label="Confirm Password"
            value={formData.confirmPassword}
            onChangeText={(text) => {
                updateField('confirmPassword', text);
            }}
            secureTextEntry={!passwordVisibility.confirmPassword}
            autoCapitalize="none"
            autoCorrect={false}
            testID="confirm-password-input"
            colors={colors}
            variant="filled"
            error={formData.confirmPassword && !validatePasswordsMatch(formData.password, formData.confirmPassword) ? 'Passwords do not match' : undefined}
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

export default SignUpSecurityStep; 