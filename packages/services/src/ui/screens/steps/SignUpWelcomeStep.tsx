import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { View, Text, TouchableOpacity, Platform, StyleSheet, type ViewStyle, type TextStyle } from 'react-native';
import HighFive from '../../../assets/illustrations/HighFive';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

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
    const localStyles = stylesheet;
    const baseStyles = stepStyles;
    const webShadowReset = Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : null;

    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, { alignItems: 'flex-start' }]}>
                <HighFive width={100} height={100} />
            </View>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('signup.welcome.title')}</Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{t('signup.welcome.subtitle')}</Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                <View
                    style={[
                        localStyles.actionCard,
                        { backgroundColor: colors.inputBackground || colors.card || 'rgba(0,0,0,0.04)' },
                        webShadowReset,
                    ]}
                >
                    <TouchableOpacity
                        style={[
                            styles.button,
                            localStyles.primaryButton,
                            { backgroundColor: colors.primary },
                            webShadowReset,
                        ]}
                        onPress={nextStep}
                        testID="get-started-button"
                    >
                        <Text style={[styles.buttonText, localStyles.buttonText, { color: colors.background }]}>{t('common.actions.getStarted')}</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={[styles.footerTextContainer, localStyles.footerLink, { marginTop: 0 }]}
                        onPress={() => navigate('SignIn')}
                    >
                        <Text style={[styles.footerText, { color: colors.secondaryText }]}>
                            {t('signup.welcome.haveAccount')}
                            <Text style={{ color: colors.primary, fontWeight: '600' }}> {t('signup.welcome.signInCta')}</Text>
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>
        </>
    );
};

export default SignUpWelcomeStep;

const stylesheet = StyleSheet.create({
    actionCard: {
        width: '100%',
        maxWidth: 420,
        borderRadius: 28,
        paddingHorizontal: 20,
        paddingVertical: 18,
        gap: STEP_INNER_GAP,
        alignItems: 'stretch',
        shadowColor: 'transparent',
    },
    primaryButton: {
        borderRadius: 28,
        width: '100%',
        paddingVertical: 16,
        justifyContent: 'center',
        shadowOpacity: 0,
        shadowRadius: 0,
        shadowOffset: { width: 0, height: 0 },
        elevation: 0,
    },
    buttonText: {
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
    },
    footerLink: {
        alignSelf: 'center',
    },
});
