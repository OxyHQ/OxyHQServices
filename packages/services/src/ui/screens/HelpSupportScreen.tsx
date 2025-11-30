import React, { useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Linking,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';

const HelpSupportScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme, colorScheme);

    const handleContactSupport = useMemo(() => () => {
        // In a real implementation, this would open a contact form or email
        Linking.openURL('mailto:support@oxy.so?subject=Support Request').catch(() => {
            toast.error(t('help.contactError') || 'Failed to open email client');
        });
    }, [t]);

    // TODO: Implement FAQ screen navigation
    // Currently shows a placeholder toast. Should navigate to a dedicated FAQ screen or modal.
    const handleFAQ = useMemo(() => () => {
        toast.info(t('help.faqComing') || 'FAQ coming soon');
    }, [t]);

    const handleReportBug = useMemo(() => () => {
        // TODO: Consider implementing a dedicated bug report form instead of just email
        Linking.openURL('mailto:bugs@oxy.so?subject=Bug Report').catch(() => {
            toast.error(t('help.reportError') || 'Failed to open email client');
        });
    }, [t]);

    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('help.title') || 'Help & Support'}

                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                {/* Help Options */}
                <Section title={t('help.options') || 'Get Help'} isFirst={true}>
                    <GroupedSection
                        items={[
                            {
                                id: 'faq',
                                icon: 'help-circle',
                                iconColor: themeStyles.colors.iconSecurity,
                                title: t('help.faq.title') || 'Frequently Asked Questions',
                                subtitle: t('help.faq.subtitle') || 'Find answers to common questions',
                                onPress: handleFAQ,
                            },
                            {
                                id: 'contact',
                                icon: 'mail',
                                iconColor: themeStyles.colors.iconPersonalInfo,
                                title: t('help.contact.title') || 'Contact Support',
                                subtitle: t('help.contact.subtitle') || 'Get help from our support team',
                                onPress: handleContactSupport,
                            },
                            {
                                id: 'report-bug',
                                icon: 'bug',
                                iconColor: themeStyles.colors.iconStorage,
                                title: t('help.reportBug.title') || 'Report a Bug',
                                subtitle: t('help.reportBug.subtitle') || 'Help us improve by reporting issues',
                                onPress: handleReportBug,
                            },
                        ]}

                    />
                </Section>

                {/* Resources */}
                <Section title={t('help.resources') || 'Resources'} >
                    <GroupedSection
                        items={[
                            {
                                id: 'documentation',
                                icon: 'document-text',
                                iconColor: '#8E8E93',
                                title: t('help.documentation.title') || 'Documentation',
                                subtitle: t('help.documentation.subtitle') || 'User guides and tutorials',
                                onPress: () => {
                                    Linking.openURL('https://developer.oxy.so/docs').catch(() => {
                                        toast.error(t('help.linkError') || 'Failed to open link');
                                    });
                                },
                            },
                            {
                                id: 'community',
                                icon: 'people',
                                iconColor: themeStyles.colors.iconData,
                                title: t('help.community.title') || 'Community',
                                subtitle: t('help.community.subtitle') || 'Join our community',
                                onPress: () => {
                                    Linking.openURL('https://community.oxy.so').catch(() => {
                                        toast.error(t('help.linkError') || 'Failed to open link');
                                    });
                                },
                            },
                            {
                                id: 'developers-portal',
                                icon: 'code',
                                iconColor: themeStyles.colors.iconSharing,
                                title: t('help.developersPortal.title') || 'Developers Portal',
                                subtitle: t('help.developersPortal.subtitle') || 'API documentation and developer resources',
                                onPress: () => {
                                    Linking.openURL('https://developer.oxy.so').catch(() => {
                                        toast.error(t('help.linkError') || 'Failed to open link');
                                    });
                                },
                            },
                        ]}

                    />
                </Section>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        padding: 16,
    },
});

export default React.memo(HelpSupportScreen);

