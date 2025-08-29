import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HighFive from '../../../assets/illustrations/HighFive';
import { useI18n } from '../../hooks/useI18n';

interface SignUpWelcomeStepProps {
    // Common props from StepBasedScreen
    colors: any;
    styles: any;
    theme: string;
    navigate: (screen: RouteName, props?: Record<string, any>) => void;

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
    const { t } = useI18n();
    return (
        <>
            <HighFive width={120} height={120} />
            <View style={styles.modernHeader}>
                <Text style={[styles.modernTitle, { color: colors.text }]}>{t('signup.welcome.title')}</Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>{t('signup.welcome.subtitle')}</Text>
            </View>

            <View style={styles.modernInputContainer}>
                <TouchableOpacity
                    style={[styles.button, { backgroundColor: colors.primary }]}
                    onPress={nextStep}
                    testID="get-started-button"
                >
                    <Ionicons name="rocket-outline" size={20} color={colors.background} />
                    <Text style={[styles.buttonText, { color: colors.background }]}>{t('common.actions.getStarted')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.footerTextContainer]}
                    onPress={() => navigate('SignIn')}
                >
                    <Text style={[styles.footerText, { color: colors.secondaryText }]}>
                        {t('signin.title')}
                    </Text>
                </TouchableOpacity>
            </View>
        </>
    );
};

export default SignUpWelcomeStep;
