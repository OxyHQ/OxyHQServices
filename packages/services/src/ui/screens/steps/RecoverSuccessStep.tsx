import type React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';

interface RecoverSuccessStepProps {
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
    allStepData: any[];

    // Form state
    successMessage: string;
}

const RecoverSuccessStep: React.FC<RecoverSuccessStepProps> = ({
    colors,
    styles,
    navigate,
    allStepData,
    successMessage,
}) => {
    // Extract identifier from previous steps
    const requestData = allStepData[0] || {};
    const { identifier } = requestData;

    const handleContinueToReset = () => {
        // Navigate to password reset with the identifier
        navigate('ResetPassword', { identifier });
    };

    const handleBackToSignIn = () => {
        navigate('SignIn');
    };

    return (
        <>
            <View style={{
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 32,
            }}>
                <View style={{
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    backgroundColor: colors.success + '20',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 24,
                }}>
                    <Ionicons name="checkmark-circle" size={40} color={colors.success} />
                </View>
            </View>

            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    Account Verified!
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Your account has been successfully verified.
                </Text>
            </View>

            <View style={styles.modernInputContainer}>
                <View style={{
                    padding: 20,
                    backgroundColor: colors.inputBackground,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    marginBottom: 24,
                }}>
                    <Text style={[styles.footerText, { color: colors.text, fontSize: 16, marginBottom: 8 }]}>
                        What's next?
                    </Text>
                    <Text style={[styles.footerText, { color: colors.secondaryText, fontSize: 14, lineHeight: 20 }]}>
                        You can now reset your password or return to sign in with your existing credentials.
                    </Text>
                </View>

                <View style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 12,
                    backgroundColor: colors.success + '10',
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.success + '30',
                }}>
                    <Ionicons name="shield-checkmark" size={20} color={colors.success} style={{ marginRight: 8 }} />
                    <Text style={[styles.footerText, { color: colors.success, fontSize: 14, flex: 1 }]}>
                        {successMessage || 'Your account recovery is complete and secure.'}
                    </Text>
                </View>
            </View>

            <GroupedPillButtons
                buttons={[
                    {
                        text: 'Back to Sign In',
                        onPress: handleBackToSignIn,
                        icon: 'arrow-back',
                        variant: 'transparent',
                    },
                    {
                        text: 'Reset Password',
                        onPress: handleContinueToReset,
                        icon: 'key-outline',
                        variant: 'primary',
                    },
                ]}
                colors={colors}
            />
        </>
    );
};

export default RecoverSuccessStep;
