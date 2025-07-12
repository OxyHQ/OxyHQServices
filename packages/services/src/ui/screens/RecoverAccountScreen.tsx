import React, { useState, useRef, useCallback } from 'react';
import { View, Text, Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, StatusBar, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TextField from '../components/internal/TextField';
import GroupedPillButtons from '../components/internal/GroupedPillButtons';
import HighFive from '../../assets/illustrations/HighFive';
import { useThemeColors } from '../styles';
import PinInput from '../components/internal/PinInput';

interface RecoverAccountScreenProps {
    navigate: (screen: string) => void;
    theme: string;
}

const PIN_LENGTH = 6;

const RecoverAccountScreen: React.FC<RecoverAccountScreenProps> = ({ navigate, theme }) => {
    const [identifier, setIdentifier] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const [successMessage, setSuccessMessage] = useState('');
    const [step, setStep] = useState<'request' | 'code' | 'done'>('request');
    const [code, setCode] = useState('');
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const colors = useThemeColors(theme as 'light' | 'dark');
    const styles = createStyles(colors);
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
                                icon="mail-outline"
                                value={identifier}
                                onChangeText={setIdentifier}
                                autoCapitalize="none"
                                autoCorrect={false}
                                colors={colors}
                                variant="filled"
                                error={errorMessage || undefined}
                                editable={!isLoading}
                                autoFocus
                                testID="recover-identifier-input"
                                validMessage={successMessage || undefined}
                                onSubmitEditing={handleRequestWithFocus}
                            />
                            <GroupedPillButtons
                                buttons={[
                                    {
                                        text: 'Back to Sign In',
                                        onPress: () => navigate('SignIn'),
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
                                        onPress: () => setStep('request'),
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
                                        text: 'Back to Sign In',
                                        onPress: () => navigate('SignIn'),
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

const createStyles = (colors: any) => StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 4,
        paddingBottom: 20,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
    },
    modernHeader: {
        alignItems: 'flex-start',
        width: '100%',
        marginBottom: 24,
    },
    modernTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 62,
        lineHeight: 48,
        marginBottom: 18,
        textAlign: 'left',
        letterSpacing: -1,
    },
    modernSubtitle: {
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'left',
        opacity: 0.8,
        marginBottom: 24,
    },
    successCard: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderRadius: 16,
        marginBottom: 24,
        gap: 12,
        width: '100%',
    },
    belowInputMessage: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
        marginBottom: 0,
        gap: 6,
    },
    belowInputText: {
        fontSize: 13,
        fontWeight: '500',
    },
    successText: {
        fontSize: 14,
        fontWeight: '500',
        flex: 1,
    },
});

export default RecoverAccountScreen; 