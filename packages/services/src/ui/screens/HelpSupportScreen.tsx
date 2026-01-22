import React, { useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    Linking,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';

const HelpSupportScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
}) => {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);

    const handleContactSupport = useMemo(() => () => {
        Linking.openURL('mailto:support@oxy.so?subject=Support Request').catch(() => {
            toast.error(t('help.contactError') || 'Failed to open email client');
        });
    }, [t]);

    const handleFAQ = useMemo(() => () => {
        if (navigate) {
            navigate('FAQ');
        } else {
            toast.info(t('help.faqComing') || 'FAQ coming soon');
        }
    }, [navigate, t]);

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
                                icon: 'file-document',
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
                                icon: 'account-group',
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
                                icon: 'code-tags',
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

