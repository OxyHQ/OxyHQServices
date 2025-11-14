import React, { useMemo, useState, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Linking,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { toast } from '../../lib/sonner';
import { Header, Section, GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';

const LegalDocumentsScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
    initialStep,
}) => {
    const { t } = useI18n();
    const [loading, setLoading] = useState(false);

    // Policy URLs from Oxy Transparency Center
    const POLICY_URLS = {
        privacy: 'https://oxy.so/company/transparency/policies/privacy',
        terms: 'https://oxy.so/company/transparency/policies/terms-of-service',
        community: 'https://oxy.so/company/transparency/policies/community-guidelines',
        dataRetention: 'https://oxy.so/company/transparency/policies/data-retention',
        contentModeration: 'https://oxy.so/company/transparency/policies/content-moderation',
        childSafety: 'https://oxy.so/company/transparency/policies/child-safety',
        cookie: 'https://oxy.so/company/transparency/policies/cookies',
    };

    // Determine which document to show based on initialStep
    const documentType = initialStep === 1 ? 'privacy'
        : initialStep === 2 ? 'terms'
            : initialStep === 3 ? 'community'
                : initialStep === 4 ? 'dataRetention'
                    : initialStep === 5 ? 'contentModeration'
                        : initialStep === 6 ? 'childSafety'
                            : initialStep === 7 ? 'cookie'
                                : null;

    // Generic handler to open any policy URL
    const handleOpenPolicy = useCallback((policyKey: keyof typeof POLICY_URLS) => {
        return async () => {
            try {
                setLoading(true);
                const url = POLICY_URLS[policyKey];
                const canOpen = await Linking.canOpenURL(url);
                if (canOpen) {
                    await Linking.openURL(url);
                } else {
                    toast.error(t('legal.openError') || 'Failed to open document');
                }
            } catch (error) {
                console.error(`Failed to open ${policyKey} policy:`, error);
                toast.error(t('legal.openError') || 'Failed to open document');
            } finally {
                setLoading(false);
            }
        };
    }, [t]);

    const themeStyles = useMemo(() => {
        const isDarkTheme = theme === 'dark';
        return {
            textColor: isDarkTheme ? '#FFFFFF' : '#000000',
            backgroundColor: isDarkTheme ? '#121212' : '#FFFFFF',
            secondaryBackgroundColor: isDarkTheme ? '#222222' : '#F5F5F5',
            borderColor: isDarkTheme ? '#444444' : '#E0E0E0',
        };
    }, [theme]);

    // If a specific document type is requested, open it directly
    React.useEffect(() => {
        if (documentType) {
            handleOpenPolicy(documentType)();
        }
    }, [documentType, handleOpenPolicy]);

    // Get policy title for display
    const getPolicyTitle = (key: string) => {
        const titles: Record<string, string> = {
            privacy: t('legal.privacyPolicy.title') || 'Privacy Policy',
            terms: t('legal.termsOfService.title') || 'Terms of Service',
            community: t('legal.communityGuidelines.title') || 'Community Guidelines',
            dataRetention: t('legal.dataRetention.title') || 'Data Retention Policy',
            contentModeration: t('legal.contentModeration.title') || 'Content Moderation Policy',
            childSafety: t('legal.childSafety.title') || 'Child Safety Policy',
            cookie: t('legal.cookiePolicy.title') || 'Cookie Policy',
        };
        return titles[key] || 'Document';
    };

    // If a specific document type is requested, show loading state while opening
    if (documentType) {
        return (
            <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
                <Header
                    title={getPolicyTitle(documentType)}
                    theme={theme}
                    onBack={goBack || onClose}
                    variant="minimal"
                    elevation="subtle"
                />
                <View style={styles.loadingContainer}>
                    <ActivityIndicator size="large" color={themeStyles.textColor} />
                    <Text style={[styles.loadingText, { color: themeStyles.textColor }]}>
                        {t('legal.opening') || 'Opening document...'}
                    </Text>
                </View>
            </View>
        );
    }

    // Default: show both options
    return (
        <View style={[styles.container, { backgroundColor: themeStyles.backgroundColor }]}>
            <Header
                title={t('legal.title') || 'Legal Documents'}
                theme={theme}
                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                <Section title={t('legal.policies') || 'Policies & Guidelines'} theme={theme} isFirst={true}>
                    <GroupedSection
                        items={[
                            {
                                id: 'privacy-policy',
                                icon: 'shield-checkmark',
                                iconColor: '#30D158',
                                title: t('legal.privacyPolicy.title') || 'Privacy Policy',
                                subtitle: t('legal.privacyPolicy.subtitle') || 'How we handle your data',
                                onPress: handleOpenPolicy('privacy'),
                            },
                            {
                                id: 'terms-of-service',
                                icon: 'document-text',
                                iconColor: '#007AFF',
                                title: t('legal.termsOfService.title') || 'Terms of Service',
                                subtitle: t('legal.termsOfService.subtitle') || 'Terms and conditions of use',
                                onPress: handleOpenPolicy('terms'),
                            },
                            {
                                id: 'community-guidelines',
                                icon: 'people',
                                iconColor: '#5856D6',
                                title: t('legal.communityGuidelines.title') || 'Community Guidelines',
                                subtitle: t('legal.communityGuidelines.subtitle') || 'Rules and expectations for our community',
                                onPress: handleOpenPolicy('community'),
                            },
                            {
                                id: 'data-retention',
                                icon: 'time',
                                iconColor: '#FF9500',
                                title: t('legal.dataRetention.title') || 'Data Retention Policy',
                                subtitle: t('legal.dataRetention.subtitle') || 'How long we keep your data',
                                onPress: handleOpenPolicy('dataRetention'),
                            },
                            {
                                id: 'content-moderation',
                                icon: 'eye',
                                iconColor: '#FF3B30',
                                title: t('legal.contentModeration.title') || 'Content Moderation Policy',
                                subtitle: t('legal.contentModeration.subtitle') || 'How we moderate content',
                                onPress: handleOpenPolicy('contentModeration'),
                            },
                            {
                                id: 'child-safety',
                                icon: 'heart',
                                iconColor: '#FF2D55',
                                title: t('legal.childSafety.title') || 'Child Safety Policy',
                                subtitle: t('legal.childSafety.subtitle') || 'Protecting minors on our platform',
                                onPress: handleOpenPolicy('childSafety'),
                            },
                            {
                                id: 'cookie-policy',
                                icon: 'cookie',
                                iconColor: '#8E8E93',
                                title: t('legal.cookiePolicy.title') || 'Cookie Policy',
                                subtitle: t('legal.cookiePolicy.subtitle') || 'How we use cookies and similar technologies',
                                onPress: handleOpenPolicy('cookie'),
                            },
                        ]}
                        theme={theme}
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
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
    },
    loadingText: {
        fontSize: 16,
        marginTop: 12,
    },
});

export default React.memo(LegalDocumentsScreen);

