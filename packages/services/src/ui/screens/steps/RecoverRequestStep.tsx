import type React from 'react';
import { useRef } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';
import TextField from '../../components/internal/TextField';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';

interface RecoverRequestStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: string, props?: Record<string, any>) => void;

    // Step navigation
    nextStep: () => void;
    currentStep: number;
    totalSteps: number;

    // Data management
    stepData?: any;
    updateStepData: (data: any) => void;

    // Form state
    identifier: string;
    setIdentifier: (identifier: string) => void;
    errorMessage: string;
    setErrorMessage: (message: string) => void;
    isLoading: boolean;
    setIsLoading: (loading: boolean) => void;
}

const RecoverRequestStep: React.FC<RecoverRequestStepProps> = ({
    colors,
    styles,
    navigate,
    nextStep,
    identifier,
    setIdentifier,
    errorMessage,
    setErrorMessage,
    isLoading,
    setIsLoading,
}) => {
    const inputRef = useRef<any>(null);

    const handleIdentifierChange = (text: string) => {
        setIdentifier(text);
        if (errorMessage) setErrorMessage('');
    };

    const handleRequest = () => {
        if (!identifier || identifier.length < 3) {
            setErrorMessage('Please enter your email or username.');
            setTimeout(() => inputRef.current?.focus(), 0);
            return;
        }

        setErrorMessage('');
        setIsLoading(true);

        // Simulate API call
        setTimeout(() => {
            setIsLoading(false);
            nextStep(); // Move to verification step
        }, 1200);
    };

    const handleRequestWithFocus = () => {
        if (!identifier) {
            setTimeout(() => inputRef.current?.focus(), 0);
        }
        handleRequest();
    };

    return (
        <>
            <HighFive width={100} height={100} />
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    Recover Account
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Enter your email or username to receive a 6-digit code.
                </Text>
            </View>

            <View style={styles.modernInputContainer}>
                <TextField
                    ref={inputRef}
                    label="Email or Username"
                    leading={<Ionicons name="mail-outline" size={24} color={colors.secondaryText} />}
                    value={identifier}
                    onChangeText={handleIdentifierChange}
                    autoCapitalize="none"
                    autoCorrect={false}
                    testID="recover-identifier-input"
                    variant="filled"
                    error={errorMessage || undefined}
                    editable={!isLoading}
                    onSubmitEditing={handleRequestWithFocus}
                    autoFocus
                />
            </View>

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
    );
};

export default RecoverRequestStep;
