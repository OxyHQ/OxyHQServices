import type React from 'react';
import type { RouteName } from '../../navigation/routes';
import { View, Text } from 'react-native';
import GroupedPillButtons from '../../components/internal/GroupedPillButtons';
import { Section, GroupedSection } from '../../components';
import { useI18n } from '../../hooks/useI18n';
import { STEP_GAP, stepStyles } from '../../styles/spacing';

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
    theme,
    nextStep,
    prevStep,
    allStepData,
    isLoading,
}) => {
    const { t } = useI18n();
    const baseStyles = stepStyles;
    // Extract data from previous steps
    const identityData = allStepData[1] || {}; // Step 2 (index 1)
    const securityData = allStepData[2] || {}; // Step 3 (index 2)

    const { username = '', email = '' } = identityData;
    const { password = '' } = securityData;

    // Check if all required data is available
    const hasValidData = username && email && password;

    return (
        <>
            <View style={[baseStyles.container, { marginBottom: STEP_GAP }, baseStyles.header]}>
                <Text style={[styles.modernTitle, baseStyles.title, { color: colors.text, marginBottom: 0, marginTop: 0 }]}>
                    {t('signup.summary.title')}
                </Text>
                <Text style={[styles.modernSubtitle, baseStyles.subtitle, { color: colors.secondaryText, marginBottom: 0, marginTop: 0 }]}>
                    {t('signup.summary.subtitle')}
                </Text>
            </View>

            <View style={[baseStyles.container, { marginBottom: STEP_GAP }]}>
                <Section
                    title={t('signup.summary.sections.account') || t('signup.summary.sectionTitle') || 'Account Information'}
                    
                    isFirst={true}
                >
                    <GroupedSection
                        items={[
                            {
                                id: 'username',
                                icon: 'person-outline',
                                iconColor: colors.primary,
                                title: t('signup.summary.fields.username'),
                                subtitle: `@${username || t('signup.summary.notSet')}`,
                                showChevron: false,
                            },
                            {
                                id: 'email',
                                icon: 'mail-outline',
                                iconColor: colors.primary,
                                title: t('signup.summary.fields.email'),
                                subtitle: email || t('signup.summary.notSet'),
                                showChevron: false,
                            },
                            {
                                id: 'password',
                                icon: 'lock-closed-outline',
                                iconColor: colors.primary,
                                title: t('signup.summary.fields.password') || 'Password',
                                subtitle: password ? '••••••••' : t('signup.summary.notSet'),
                                showChevron: false,
                            },
                        ]}
                        
                    />
                </Section>

                <Section
                    title={t('signup.summary.sections.next') || 'Next Steps'}
                    
                >
                    <GroupedSection
                        items={[
                            {
                                id: 'security-tip',
                                icon: 'shield-checkmark',
                                iconColor: colors.warning,
                                title: t('signup.summary.next.securityTitle') || 'Keep your account secure',
                                subtitle: t('signup.summary.securityTip'),
                                showChevron: false,
                                multiRow: true,
                                dense: true,
                            },
                            {
                                id: 'legal-reminder',
                                icon: 'checkmark-circle',
                                iconColor: colors.success,
                                title: t('signup.summary.next.legalTitle') || 'You’re all set',
                                subtitle: t('signup.summary.legalReminder'),
                                showChevron: false,
                                multiRow: true,
                                dense: true,
                            },
                        ]}
                        
                    />
                </Section>
            </View>

            <View style={[baseStyles.container, { marginBottom: 0 }, baseStyles.buttonContainer]}>
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
