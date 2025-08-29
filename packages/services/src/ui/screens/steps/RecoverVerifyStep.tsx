import type React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import PinInput from '../../components/internal/PinInput';
import { toast } from '../../../lib/sonner';

interface RecoverVerifyStepProps {
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
    verificationCode: string;
    setVerificationCode: (code: string) => void;
    errorMessage: string;
    setErrorMessage: (message: string) => void;
    successMessage: string;
    setSuccessMessage: (message: string) => void;
    isLoading: boolean;
    setIsLoading: (loading: boolean) => void;
    identifier?: string;
}

const RecoverVerifyStep: React.FC<RecoverVerifyStepProps> = ({
    colors,
    styles,
    nextStep,
    prevStep,
    verificationCode,
    setVerificationCode,
    errorMessage,
    setErrorMessage,
    successMessage,
    setSuccessMessage,
    isLoading,
    setIsLoading,
    identifier,
}) => {
    const handleVerifyCode = async () => {
        setErrorMessage('');
        setSuccessMessage('');

        if (verificationCode.length !== 6) {
            setErrorMessage('Please enter the 6-digit code.');
            return;
        }
        // For recovery via TOTP, proceed to reset step; server will validate during reset
        nextStep();
    };

    return (
        <>
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    Verify Code
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Enter the 6-digit code sent to your email or phone.
                </Text>
            </View>

            <View style={styles.modernInputContainer}>
                <PinInput
                    value={verificationCode}
                    onChange={setVerificationCode}
                    length={6}
                    disabled={isLoading}
                    autoFocus
                    colors={colors}
                />

                {successMessage && (
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 16,
                        padding: 12,
                        backgroundColor: colors.success + '10',
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: colors.success + '30',
                    }}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} style={{ marginRight: 8 }} />
                        <Text style={[styles.footerText, { color: colors.success, fontSize: 14 }]}>
                            {successMessage}
                        </Text>
                    </View>
                )}

                {errorMessage && (
                    <View style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginTop: 16,
                        padding: 12,
                        backgroundColor: colors.error + '10',
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: colors.error + '30',
                    }}>
                        <Ionicons name="alert-circle" size={20} color={colors.error} style={{ marginRight: 8 }} />
                        <Text style={[styles.footerText, { color: colors.error, fontSize: 14 }]}>
                            {errorMessage}
                        </Text>
                    </View>
                )}
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
                        text: 'Verify Code',
                        onPress: handleVerifyCode,
                        icon: 'checkmark-circle-outline',
                        variant: 'primary',
                        loading: isLoading,
                        disabled: isLoading || verificationCode.length !== 6,
                    },
                ]}
                colors={colors}
            />
        </>
    );
};

export default RecoverVerifyStep;
