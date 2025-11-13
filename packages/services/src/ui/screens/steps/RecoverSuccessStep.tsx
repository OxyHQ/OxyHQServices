import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import { useI18n } from '../../hooks/useI18n';
import { STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

interface RecoverSuccessStepProps {
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
    const { t } = useI18n();
    const baseStyles = stepStyles;
    // Extract identifier from previous steps
    const requestData = allStepData[0] || {};
    const { identifier } = requestData;

    const handleContinueToReset = () => {
        // Navigate back to SignIn and let host app open its reset flow
        navigate('SignIn', { showReset: true, identifier });
    };

    const handleBackToSignIn = () => {
        navigate('SignIn');
    };

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, stylesheet.iconContainer]}>
                <View style={[stylesheet.successIcon, { backgroundColor: colors.success + '20' }]}>
                    <Ionicons name="checkmark-circle" size={40} color={colors.success} />
                </View>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('recover.title')}</Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{successMessage || t('recover.resetSuccess')}</Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                <View style={[stylesheet.infoCard, {
                    backgroundColor: colors.inputBackground,
                    borderColor: colors.border,
                }]}>
                    <Text style={[styles.footerText, stylesheet.infoTitle, { color: colors.text }]}>
                        {t('recover.whatsNextTitle') || "What's next?"}
                    </Text>
                    <Text style={[styles.footerText, stylesheet.infoBody, { color: colors.secondaryText }]}>
                        {t('recover.whatsNextBody') || 'You can now reset your password or return to sign in with your existing credentials.'}
                    </Text>
                </View>

                <View style={[stylesheet.successBanner, {
                    backgroundColor: colors.success + '10',
                    borderColor: colors.success + '30',
                }]}>
                    <Ionicons name="shield-checkmark" size={20} color={colors.success} />
                    <Text style={[styles.footerText, stylesheet.bannerText, { color: colors.success }]}>
                        {successMessage || t('recover.completeSecure') || 'Your account recovery is complete and secure.'}
                    </Text>
                </View>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.buttonContainer]}>
                <GroupedPillButtons
                    buttons={[
                        {
                            text: t('common.actions.signIn'),
                            onPress: handleBackToSignIn,
                            icon: 'arrow-back',
                            variant: 'transparent',
                        },
                    ]}
                    colors={colors}
                />
            </View>
        </>
    );
};

export default RecoverSuccessStep;

const stylesheet = StyleSheet.create({
    iconContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    successIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    infoCard: {
        padding: STEP_INNER_GAP * 2,
        borderRadius: 16,
        borderWidth: 1,
        marginBottom: STEP_INNER_GAP,
        gap: STEP_INNER_GAP,
    },
    infoTitle: {
        fontSize: 16,
        marginBottom: 0,
    },
    infoBody: {
        fontSize: 14,
        lineHeight: 20,
    },
    successBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: STEP_INNER_GAP,
        borderRadius: 8,
        borderWidth: 1,
        gap: STEP_INNER_GAP,
    },
    bannerText: {
        flex: 1,
        fontSize: 14,
    },
});
