import React, { useMemo } from 'react';
import {
    View,
    StyleSheet,
    ScrollView,
    Linking,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { Header } from '../components';
import { SettingsIcon } from '../components/SettingsIcon';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useColorScheme } from '../hooks/useColorScheme';
import { Colors } from '../constants/theme';
import { normalizeColorScheme } from '../utils/themeUtils';
import { SettingsListGroup, SettingsListItem } from '@oxyhq/bloom/settings-list';

const HelpSupportScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    navigate,
}) => {
    const { t } = useI18n();
    const bloomTheme = useTheme();
    const colorScheme = useColorScheme();
    const normalizedColorScheme = normalizeColorScheme(colorScheme);
    const themeColors = Colors[normalizedColorScheme];

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
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('help.title') || 'Help & Support'}

                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                {/* Help Options */}
                <SettingsListGroup title={t('help.options') || 'Get Help'}>
                    <SettingsListItem
                        icon={<SettingsIcon name="help-circle" color={themeColors.iconSecurity} />}
                        title={t('help.faq.title') || 'Frequently Asked Questions'}
                        description={t('help.faq.subtitle') || 'Find answers to common questions'}
                        onPress={handleFAQ}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="email" color={themeColors.iconPersonalInfo} />}
                        title={t('help.contact.title') || 'Contact Support'}
                        description={t('help.contact.subtitle') || 'Get help from our support team'}
                        onPress={handleContactSupport}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="bug" color={themeColors.iconStorage} />}
                        title={t('help.reportBug.title') || 'Report a Bug'}
                        description={t('help.reportBug.subtitle') || 'Help us improve by reporting issues'}
                        onPress={handleReportBug}
                    />
                </SettingsListGroup>

                {/* Resources */}
                <SettingsListGroup title={t('help.resources') || 'Resources'}>
                    <SettingsListItem
                        icon={<SettingsIcon name="file-document" color="#8E8E93" />}
                        title={t('help.documentation.title') || 'Documentation'}
                        description={t('help.documentation.subtitle') || 'User guides and tutorials'}
                        onPress={() => {
                            Linking.openURL('https://developer.oxy.so/docs').catch(() => {
                                toast.error(t('help.linkError') || 'Failed to open link');
                            });
                        }}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="account-group" color={themeColors.iconData} />}
                        title={t('help.community.title') || 'Community'}
                        description={t('help.community.subtitle') || 'Join our community'}
                        onPress={() => {
                            Linking.openURL('https://community.oxy.so').catch(() => {
                                toast.error(t('help.linkError') || 'Failed to open link');
                            });
                        }}
                    />
                    <SettingsListItem
                        icon={<SettingsIcon name="code-tags" color={themeColors.iconSharing} />}
                        title={t('help.developersPortal.title') || 'Developers Portal'}
                        description={t('help.developersPortal.subtitle') || 'API documentation and developer resources'}
                        onPress={() => {
                            Linking.openURL('https://developer.oxy.so').catch(() => {
                                toast.error(t('help.linkError') || 'Failed to open link');
                            });
                        }}
                    />
                </SettingsListGroup>
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
