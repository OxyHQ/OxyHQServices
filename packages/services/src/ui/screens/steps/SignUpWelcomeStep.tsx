import type React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';

interface SignUpWelcomeStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: string, props?: Record<string, any>) => void;

    // Step navigation
    nextStep: () => void;
    currentStep: number;
    totalSteps: number;
}

const SignUpWelcomeStep: React.FC<SignUpWelcomeStepProps> = ({
    colors,
    styles,
    navigate,
    nextStep,
}) => {
    return (
        <>
            <HighFive width={120} height={120} />
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>
                    Welcome to Oxy!
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Let's create your account in just a few steps
                </Text>
            </View>

            <View style={styles.modernInputContainer}>
                <TouchableOpacity
                    style={[styles.button, { backgroundColor: colors.primary }]}
                    onPress={nextStep}
                    testID="get-started-button"
                >
                    <Ionicons name="rocket-outline" size={20} color={colors.background} />
                    <Text style={[styles.buttonText, { color: colors.background }]}>
                        Get Started
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.footerTextContainer]}
                    onPress={() => navigate('SignIn')}
                >
                    <Text style={[styles.footerText, { color: colors.secondaryText }]}>
                        Already have an account?{' '}
                        <Text style={[styles.linkText, { color: colors.primary }]}>
                            Sign In
                        </Text>
                    </Text>
                </TouchableOpacity>
            </View>
        </>
    );
};

export default SignUpWelcomeStep;
