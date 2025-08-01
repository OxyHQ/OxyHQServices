import type React from 'react';
import { useState, useRef, useCallback } from 'react';
import { View, Text, Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, StatusBar, type TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TextField from '../components/internal/TextField';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import HighFive from '../../assets/illustrations/HighFive';
import { useThemeColors, createAuthStyles } from '../styles';
import PinInput from '../components/internal/PinInput';

interface RecoverAccountScreenProps {
    navigate: (screen: string, props?: Record<string, any>) => void;
    goBack: () => void;
    theme: string;
    returnTo?: string;
    returnStep?: number;
    returnData?: Record<string, any>;
}

const PIN_LENGTH = 6;

const RecoverAccountScreen: React.FC<RecoverAccountScreenProps> = ({ navigate, goBack, theme, returnTo, returnStep, returnData }) => {
    const [identifier, setIdentifier] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [step, setStep] = useState<'request' | 'code' | 'done'>('request');
    const [code, setCode] = useState('');
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const colors = useThemeColors(theme as 'light' | 'dark');
    const styles = createAuthStyles(colors, theme);
    const identifierRef = useRef<TextInput>(null);
    const handleRequestWithFocus = () => {
        if (!identifier) {
            setTimeout(() => {
                identifierRef.current?.focus();
            }, 0);
        }
        handleRequest();
    };

    const handleRequest = async () => {
        setErrorMessage('');
        setSuccessMessage('');
        if (!identifier || identifier.length < 3) {
            setErrorMessage('Please enter your email or username.');
            return;
        }
        setIsLoading(true);
        setTimeout(() => {
            setIsLoading(false);
            setStep('code');
            setSuccessMessage('A 6-digit code has been sent to your email or phone.');
        }, 1200);
    };

    const handleVerifyCode = async () => {
        setErrorMessage('');
        setSuccessMessage('');
        if (code.length !== PIN_LENGTH) {
            setErrorMessage('Please enter the 6-digit code.');
            return;
        }
        setIsLoading(true);
        setTimeout(() => {
            setIsLoading(false);
            if (code === '123456') { // Simulate correct code
                setStep('done');
                setSuccessMessage('Your account has been verified! You can now reset your password.');
            } else {
                setErrorMessage('Invalid code. Please try again.');
            }
        }, 1200);
    };

    // Helper function to determine back action based on current step
    const handleBack = () => {
        console.log('RecoverAccount handleBack:', { step, returnTo, returnStep, returnData });

        if (step === 'code') {
            setStep('request');
        } else if (step === 'done') {
            // If we have return information, use it; otherwise go to SignIn
            if (returnTo && returnStep !== undefined) {
                console.log('Navigating back to', returnTo, 'with step', returnStep, 'and data', returnData);
                navigate(returnTo, {
                    initialStep: returnStep,
                    ...returnData
                });
            } else {
                navigate('SignIn');
            }
        } else {
            // For 'request' step, if we have return information, use it; otherwise go back
            if (returnTo && returnStep !== undefined) {
                console.log('Navigating back to', returnTo, 'with step', returnStep, 'and data', returnData);
                navigate(returnTo, {
                    initialStep: returnStep,
                    ...returnData
                });
            } else {
                goBack();
            }
        }
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />
            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                <Animated.View style={[
                    styles.stepContainer,
                    { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
                ]}>
                    <HighFive width={100} height={100} />
                    <View style={styles.modernHeader}>
                        <Text style={[styles.modernTitle, { color: colors.text }]}>Recover Account</Text>
                        <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>Enter your email or username to receive a 6-digit code.</Text>
                    </View>
                    {step === 'request' && (
                        <>
                            <TextField
                                ref={identifierRef}
                                label="Email or Username"
                                leading={<Ionicons name="mail-outline" size={24} color={colors.secondaryText} />}
                                value={identifier}
                                onChangeText={setIdentifier}
                                autoCapitalize="none"
                                autoCorrect={false}
                                variant="filled"
                                error={errorMessage || undefined}
                                editable={!isLoading}
                                autoFocus
                                testID="recover-identifier-input"
                                onSubmitEditing={handleRequestWithFocus}
                            />
                            <GroupedPillButtons
                                buttons={[
                                    {
                                        text: 'Back',
                                        onPress: handleBack,
                                        icon: 'arrow-back',
                                        variant: 'transparent',
                                    },
                                    {
                                        text: 'Send Code',
                                        onPress: handleRequest,
                                        icon: 'mail-open-outline',
                                        variant: 'primary',
                                        loading: isLoading,
                                        disabled: isLoading,
                                    },
                                ]}
                                colors={colors}
                            />
                        </>
                    )}
                    {step === 'code' && (
                        <>
                            <PinInput
                                value={code}
                                onChange={setCode}
                                length={PIN_LENGTH}
                                disabled={isLoading}
                                autoFocus
                                colors={colors}
                            />
                            {successMessage && (
                                <View style={styles.belowInputMessage}>
                                    <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                                    <Text style={[styles.belowInputText, { color: colors.success }]}>{successMessage}</Text>
                                </View>
                            )}
                            {errorMessage ? (
                                <Text style={[styles.successText, { color: colors.error, marginBottom: 12 }]}>{errorMessage}</Text>
                            ) : null}
                            <GroupedPillButtons
                                buttons={[
                                    {
                                        text: 'Back',
                                        onPress: handleBack,
                                        icon: 'arrow-back',
                                        variant: 'transparent',
                                    },
                                    {
                                        text: 'Verify Code',
                                        onPress: handleVerifyCode,
                                        icon: 'checkmark-circle-outline',
                                        variant: 'primary',
                                        loading: isLoading,
                                        disabled: isLoading,
                                    },
                                ]}
                                colors={colors}
                            />
                        </>
                    )}
                    {step === 'done' && (
                        <>
                            <Text style={[styles.successText, { color: colors.success, marginBottom: 24 }]}>{successMessage}</Text>
                            <GroupedPillButtons
                                buttons={[
                                    {
                                        text: 'Back',
                                        onPress: handleBack,
                                        icon: 'arrow-back',
                                        variant: 'primary',
                                    },
                                ]}
                                colors={colors}
                            />
                        </>
                    )}
                </Animated.View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
};



export default RecoverAccountScreen; 