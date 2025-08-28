import type React from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';

interface SignUpSummaryStepProps {
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
    allStepData: any[];

    // Form state
    isLoading: boolean;
}

const SignUpSummaryStep: React.FC<SignUpSummaryStepProps> = ({
    colors,
    styles,
    nextStep,
    prevStep,
    allStepData,
    isLoading,
}) => {
    // Extract data from previous steps
    const identityData = allStepData[1] || {}; // Step 2 (index 1)
    const securityData = allStepData[2] || {}; // Step 3 (index 2)

    const { username = '', email = '' } = identityData;
    const { password = '' } = securityData;

    // Check if all required data is available
    const hasValidData = username && email && password;



    return (
        <>
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    Almost There!
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Review your information and create your account
                </Text>
            </View>

            <View style={[styles.modernInputContainer, { marginBottom: 32 }]}>
                <View style={{
                    backgroundColor: colors.inputBackground,
                    borderRadius: 16,
                    padding: 20,
                    borderWidth: 1,
                    borderColor: colors.border,
                }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                        <Ionicons name="person-outline" size={20} color={colors.secondaryText} style={{ marginRight: 12 }} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.footerText, { color: colors.secondaryText, fontSize: 12, marginBottom: 4 }]}>
                                Username
                            </Text>
                            <Text style={[styles.modernInput, { color: colors.text, fontSize: 16 }]}>
                                @{username || 'Not set'}
                            </Text>
                        </View>
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="mail-outline" size={20} color={colors.secondaryText} style={{ marginRight: 12 }} />
                        <View style={{ flex: 1 }}>
                            <Text style={[styles.footerText, { color: colors.secondaryText, fontSize: 12, marginBottom: 4 }]}>
                                Email
                            </Text>
                            <Text style={[styles.modernInput, { color: colors.text, fontSize: 16 }]}>
                                {email || 'Not set'}
                            </Text>
                        </View>
                    </View>
                </View>

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
                    <Text style={[styles.footerText, { color: colors.success, fontSize: 14, flex: 1 }]}>
                        By creating an account, you agree to our Terms of Service and Privacy Policy
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
                        text: 'Create Account',
                        onPress: nextStep,
                        icon: 'checkmark-circle',
                        variant: 'primary',
                        loading: isLoading,
                        disabled: !hasValidData,
                    },
                ]}
                colors={colors}
            />
        </>
    );
};

export default SignUpSummaryStep;
