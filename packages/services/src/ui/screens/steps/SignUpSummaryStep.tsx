import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, STEP_INNER_GAP, stepStyles } from '../../styles/spacing';

interface SignUpSummaryStepProps {
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
    const { t } = useI18n();
    const baseStyles = stepStyles;
    const webShadowReset = Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : null;
    // Extract data from previous steps
    const identityData = allStepData[1] || {}; // Step 2 (index 1)
    const securityData = allStepData[2] || {}; // Step 3 (index 2)

    const { username = '', email = '' } = identityData;
    const { password = '' } = securityData;

    // Check if all required data is available
    const hasValidData = username && email && password;



    return (
        <>
            <View style={[baseStyles.container, baseStyles.sectionSpacing, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>{t('signup.summary.title')}</Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>{t('signup.summary.subtitle')}</Text>
            </View>

            <View style={[baseStyles.container, baseStyles.sectionSpacing]}>
                <View
                    style={[
                        stylesheet.summaryCard,
                        { backgroundColor: colors.inputBackground || colors.card || 'rgba(0,0,0,0.04)', borderColor: colors.border },
                        webShadowReset,
                    ]}
                >
                    <View style={stylesheet.summaryRow}>
                        <Ionicons name="person-outline" size={20} color={colors.secondaryText} style={stylesheet.summaryIcon} />
                        <View style={stylesheet.summaryContent}>
                            <Text style={[styles.footerText, stylesheet.summaryLabel, { color: colors.secondaryText }]}>
                                {t('signup.summary.fields.username')}
                            </Text>
                            <Text style={[styles.modernInput, stylesheet.summaryValue, { color: colors.text }]}>
                                @{username || t('signup.summary.notSet')}
                            </Text>
                        </View>
                    </View>

                    <View style={stylesheet.summaryRow}>
                        <Ionicons name="mail-outline" size={20} color={colors.secondaryText} style={stylesheet.summaryIcon} />
                        <View style={stylesheet.summaryContent}>
                            <Text style={[styles.footerText, stylesheet.summaryLabel, { color: colors.secondaryText }]}>
                                {t('signup.summary.fields.email')}
                            </Text>
                            <Text style={[styles.modernInput, stylesheet.summaryValue, { color: colors.text }]}>
                                {email || t('signup.summary.notSet')}
                            </Text>
                        </View>
                    </View>
                </View>

                <View
                    style={[
                        stylesheet.infoBanner,
                        {
                            backgroundColor: `${colors.warning}10`,
                            borderColor: `${colors.warning}30`,
                        },
                    ]}
                >
                    <Ionicons name="shield-checkmark" size={20} color={colors.warning} style={stylesheet.bannerIcon} />
                    <Text style={[styles.footerText, stylesheet.bannerText, { color: colors.warning }]}>
                        {t('signup.summary.securityTip')}
                    </Text>
                </View>

                <View
                    style={[
                        stylesheet.infoBanner,
                        {
                            backgroundColor: `${colors.success}10`,
                            borderColor: `${colors.success}30`,
                        },
                    ]}
                >
                    <Ionicons name="checkmark-circle" size={20} color={colors.success} style={stylesheet.bannerIcon} />
                    <Text style={[styles.footerText, stylesheet.bannerText, { color: colors.success }]}>
                        {t('signup.summary.legalReminder')}
                    </Text>
                </View>
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
                            text: t('common.actions.createAccount'),
                            onPress: nextStep,
                            icon: 'checkmark-circle',
                            variant: 'primary',
                            loading: isLoading,
                            disabled: !hasValidData,
                        },
                    ]}
                    colors={colors}
                />
            </View>
        </>
    );
};

export default SignUpSummaryStep;

const stylesheet = StyleSheet.create({
    summaryCard: {
        width: '100%',
        maxWidth: 420,
        borderRadius: 28,
        paddingHorizontal: 20,
        paddingVertical: 18,
        borderWidth: 1,
        gap: STEP_INNER_GAP,
        alignItems: 'stretch',
        shadowColor: 'transparent',
    },
    summaryRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: STEP_INNER_GAP,
    },
    summaryIcon: {
        marginRight: 0,
    },
    summaryContent: {
        flex: 1,
        gap: STEP_INNER_GAP,
    },
    summaryLabel: {
        fontSize: 12,
    },
    summaryValue: {
        fontSize: 16,
    },
    infoBanner: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: STEP_INNER_GAP,
        padding: STEP_INNER_GAP,
        borderRadius: 16,
        borderWidth: 1,
        marginTop: STEP_GAP,
    },
    bannerIcon: {
        marginTop: 0,
    },
    bannerText: {
        flex: 1,
        fontSize: 14,
    },
});
