import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { useRef, useState, useEffect, useCallback } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import TextField from '../../components/internal/TextField';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

interface SignUpIdentityStepProps {
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
    username: string;
    email: string;
    setUsername: (username: string) => void;
    setEmail: (email: string) => void;
    validationState: any;
    setValidationState: (state: any) => void;
    setErrorMessage: (message: string) => void;

    // Validation
    validateEmail: (email: string) => boolean;
    validateUsername: (username: string) => Promise<boolean>;
}

const SignUpIdentityStep: React.FC<SignUpIdentityStepProps> = ({
    colors,
    styles,
    navigate,
    nextStep,
    prevStep,
    username,
    email,
    setUsername,
    setEmail,
    validationState,
    setValidationState,
    setErrorMessage,
    validateEmail,
    validateUsername,
}) => {
    const usernameRef = useRef<any>(null);
    const baseStyles = stepStyles;
    const { t } = useI18n();
    const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Debounced username validation
    const debouncedValidateUsername = useCallback((usernameToValidate: string) => {
        if (validationTimeoutRef.current) {
            clearTimeout(validationTimeoutRef.current);
        }

        validationTimeoutRef.current = setTimeout(async () => {
            if (usernameToValidate.trim().length >= 3) {
                await validateUsername(usernameToValidate.trim());
            }
        }, 500);
    }, [validateUsername]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (validationTimeoutRef.current) {
                clearTimeout(validationTimeoutRef.current);
            }
        };
    }, []);

    const handleUsernameChange = (text: string) => {
        // Text is already filtered by formatValue prop, but ensure it's clean
        const filteredText = text.replace(/[^a-zA-Z0-9]/g, '');
        setUsername(filteredText);
        setErrorMessage('');
        // Reset validation state when user types
        if (validationState.status !== 'idle') {
            setValidationState({ status: 'idle', message: '' });
        }

        // Trigger debounced validation
        debouncedValidateUsername(filteredText);
    };

    const handleEmailChange = (text: string) => {
        setEmail(text);
        setErrorMessage('');
    };

    const handleNext = async () => {
        if (!username.trim()) {
            setErrorMessage(t('signup.username.required') || 'Please enter a username');
            setTimeout(() => usernameRef.current?.focus(), 0);
            return;
        }

        if (username.trim().length < 3) {
            setErrorMessage(t('signup.username.minLength') || 'Username must be at least 3 characters');
            setTimeout(() => usernameRef.current?.focus(), 0);
            return;
        }

        if (!email.trim()) {
            setErrorMessage(t('signup.email.required') || 'Please enter an email address');
            return;
        }

        if (!validateEmail(email)) {
            setErrorMessage(t('signup.email.invalid') || 'Please enter a valid email address');
            return;
        }

        // Validate username availability
        const isUsernameValid = await validateUsername(username.trim());
        if (!isUsernameValid) {
            setTimeout(() => usernameRef.current?.focus(), 0);
            return;
        }

        nextStep();
    };

    const emailError = email && !validateEmail(email) ? (t('signup.email.invalid') || 'Please enter a valid email address') : undefined;

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('signup.identity.title')}</Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{t('signup.identity.subtitle')}</Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing, { gap: STEP_INNER_GAP }]}>
                <TextField
                    ref={usernameRef}
                    label={t('common.labels.username')}
                    leading={<Ionicons name="person-outline" size={24} color={colors.secondaryText} />}
                    value={username}
                    onChangeText={handleUsernameChange}
                    formatValue={(text) => text.replace(/[^a-zA-Z0-9]/g, '')}
                    maxLength={30}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="signup-username-input"
                    variant="filled"
                    error={validationState.status === 'invalid' ? validationState.message : undefined}
                    loading={validationState.status === 'validating'}
                    success={validationState.status === 'valid'}
                    helperText={t('signup.username.helper') || '3-30 characters, letters and numbers only'}
                    onSubmitEditing={handleNext}
                    autoFocus
                    style={{ marginBottom: 0 }}
                />

                <TextField
                    label={t('common.labels.email')}
                    leading={<Ionicons name="mail-outline" size={24} color={colors.secondaryText} />}
                    value={email}
                    onChangeText={handleEmailChange}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="signup-email-input"
                    variant="filled"
                    error={emailError}
                    helperText={t('signup.email.helper') || 'We\'ll never share your email'}
                    onSubmitEditing={handleNext}
                    accessibilityLabel={t('common.labels.email')}
                    accessibilityHint={t('signup.email.helper') || 'Enter your email address'}
                    style={{ marginBottom: 0 }}
                />
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
                            loading: validationState.status === 'validating',
                            disabled: !username.trim() ||
                                username.trim().length < 3 ||
                                !email.trim() ||
                                !validateEmail(email) ||
                                validationState.status === 'validating' ||
                                validationState.status === 'invalid',
                        },
                    ]}
                    colors={colors}
                />
            </View>
        </>
    );
};

export default SignUpIdentityStep;
