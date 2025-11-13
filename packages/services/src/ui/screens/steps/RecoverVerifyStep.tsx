import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import PinInput from '../../components/internal/PinInput';
import { toast } from '../../../lib/sonner';
import { useI18n } from '../../hooks/useI18n';
import { STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

interface RecoverVerifyStepProps {
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
    const { t } = useI18n();
    const baseStyles = stepStyles;
    const handleVerifyCode = async () => {
        setErrorMessage('');
        setSuccessMessage('');

        if (verificationCode.length !== 6) {
            setErrorMessage(t('recover.enterCode'));
            return;
        }
        // For recovery via TOTP, proceed to reset step; server will validate during reset
        nextStep();
    };

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('recover.verify.title')}</Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{t('recover.enterCode')}</Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                <View style={stylesheet.pinInputWrapper}>
                    <PinInput
                        value={verificationCode}
                        onChange={setVerificationCode}
                        length={6}
                        disabled={isLoading}
                        autoFocus
                        colors={colors}
                    />
                </View>

                {successMessage && (
                    <View style={[stylesheet.messageContainer, {
                        backgroundColor: colors.success + '10',
                        borderColor: colors.success + '30',
                    }]}>
                        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
                        <Text style={[styles.footerText, { color: colors.success, fontSize: 14 }]}>
                            {successMessage}
                        </Text>
                    </View>
                )}

                {errorMessage && (
                    <View style={[stylesheet.messageContainer, {
                        backgroundColor: colors.error + '10',
                        borderColor: colors.error + '30',
                    }]}>
                        <Ionicons name="alert-circle" size={20} color={colors.error} />
                        <Text style={[styles.footerText, { color: colors.error, fontSize: 14 }]}>
                            {errorMessage}
                        </Text>
                    </View>
                )}
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
                            text: t('recover.verify.action'),
                            onPress: handleVerifyCode,
                            icon: 'checkmark-circle-outline',
                            variant: 'primary',
                            loading: isLoading,
                            disabled: isLoading || verificationCode.length !== 6,
                        },
                    ]}
                    colors={colors}
                />
            </View>
        </>
    );
};

export default RecoverVerifyStep;

const stylesheet = StyleSheet.create({
    pinInputWrapper: {
        marginBottom: 0,
        marginTop: 0,
    },
    messageContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: STEP_INNER_GAP,
        padding: STEP_INNER_GAP,
        borderRadius: 8,
        borderWidth: 1,
        gap: STEP_INNER_GAP,
    },
});
