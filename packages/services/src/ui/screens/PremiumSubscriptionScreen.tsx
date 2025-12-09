import type React from 'react';
import { useState, useEffect } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
    ScrollView,
    ActivityIndicator,
    Alert,
    Platform,
    Animated,
    Dimensions,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { confirmAction } from '../utils/confirmAction';
import { Ionicons } from '@expo/vector-icons';
import Avatar from '../components/Avatar';
import { useI18n } from '../hooks/useI18n';
import { useThemeStyles } from '../hooks/useThemeStyles';
import { useColorScheme } from '../hooks/use-color-scheme';
import { useOxy } from '../context/OxyContext';

interface SubscriptionPlan {
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    interval: 'month' | 'year';
    features: string[];
    appScope: 'ecosystem' | 'specific';
    applicableApps: string[]; // ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator'] etc.
    includedFeatures: string[]; // Feature IDs that are included in this plan
    isPopular?: boolean;
    isCurrentPlan?: boolean;
}

interface IndividualFeature {
    id: string;
    name: string;
    description: string;
    price: number;
    currency: string;
    interval: 'month' | 'year';
    category: 'analytics' | 'customization' | 'content' | 'networking' | 'productivity';
    appScope: 'ecosystem' | 'specific';
    applicableApps: string[]; // Apps where this feature is available
    canBePurchasedSeparately: boolean;
    includedInPlans: string[]; // Plan IDs that include this feature
    isSubscribed?: boolean;
    isIncludedInCurrentPlan?: boolean;
}

interface UserSubscription {
    id: string;
    planId: string;
    status: 'active' | 'canceled' | 'past_due' | 'trialing';
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelAtPeriodEnd: boolean;
    trialEnd?: string;
}

const PremiumSubscriptionScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    navigate,
    goBack,
}) => {
    // Use useOxy() hook for OxyContext values
    const { user, oxyServices } = useOxy();
    const [loading, setLoading] = useState(true);
    const [subscription, setSubscription] = useState<UserSubscription | null>(null);
    const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
    const [individualFeatures, setIndividualFeatures] = useState<IndividualFeature[]>([]);
    const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
    const [processingPayment, setProcessingPayment] = useState(false);
    const [billingInterval, setBillingInterval] = useState<'month' | 'year'>('month');
    const [activeTab, setActiveTab] = useState<'plans' | 'features'>('plans');
    const [currentAppPackage, setCurrentAppPackage] = useState<string>('mention'); // Default to mention for demo

    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme, colorScheme);
    // Extract commonly used colors for readability
    const { textColor, backgroundColor, secondaryBackgroundColor, borderColor, primaryColor, successColor, dangerColor, isDarkTheme } = themeStyles;
    const warningColor = '#FF9500';

    // TODO: Replace mock data with actual API integration
    // Should fetch plans from oxyServices.getSubscriptionPlans() and individual features from oxyServices.getIndividualFeatures()
    // Oxy+ subscription plans
    const mockPlans: SubscriptionPlan[] = [
        {
            id: 'mention-plus',
            name: 'Mention+',
            description: 'Enhanced features for better social experience',
            price: 4.99,
            currency: 'USD',
            interval: 'month',
            appScope: 'specific',
            applicableApps: ['mention'], // Only available in mention app
            features: [
                'Undo posts option',
                'Improved reading mode',
                'Organize bookmarks into folders',
                'Early access to select features',
                'Edit posts capability',
                'Enhanced customization options'
            ],
            includedFeatures: ['reading-mode-plus', 'custom-themes']
        },
        {
            id: 'oxy-insider',
            name: 'Oxy+ Insider',
            description: 'Exclusive access to behind-the-scenes content',
            price: 9.99,
            currency: 'USD',
            interval: 'month',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator'],
            features: [
                'Everything in Mention+',
                'Behind-the-scenes updates from creators',
                'Early access to new features',
                'Dedicated support team',
                'Exclusive content access',
                'Beta feature testing'
            ],
            includedFeatures: ['reading-mode-plus', 'custom-themes', 'analytics-basic'],
            isPopular: true
        },
        {
            id: 'oxy-connect',
            name: 'Oxy+ Connect',
            description: 'Advanced networking and community features',
            price: 14.99,
            currency: 'USD',
            interval: 'month',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator'],
            features: [
                'Everything in Oxy+ Insider',
                'Create and join private groups',
                'Advanced search and filtering tools',
                'Customizable profile highlighting',
                'Enhanced connection features',
                'Priority in community events'
            ],
            includedFeatures: ['reading-mode-plus', 'custom-themes', 'analytics-basic', 'group-management']
        },
        {
            id: 'oxy-premium',
            name: 'Oxy+ Premium',
            description: 'Complete premium experience with all perks',
            price: 24.99,
            currency: 'USD',
            interval: 'month',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator', 'oxy-analytics'],
            features: [
                'Everything in Oxy+ Connect',
                'Priority customer support',
                'Access to premium content and events',
                'Advanced analytics dashboard',
                'VIP community status',
                'Exclusive premium events'
            ],
            includedFeatures: ['reading-mode-plus', 'custom-themes', 'analytics-basic', 'analytics-advanced', 'group-management']
        },
        {
            id: 'oxy-creator',
            name: 'Oxy+ Creator',
            description: 'Professional tools for content creators',
            price: 39.99,
            currency: 'USD',
            interval: 'month',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator', 'oxy-analytics', 'oxy-studio'],
            features: [
                'Everything in Oxy+ Premium',
                'Advanced analytics and insights',
                'Promotional tools and resources',
                'Content monetization features',
                'Creator support program',
                'Revenue sharing opportunities'
            ],
            includedFeatures: ['reading-mode-plus', 'custom-themes', 'analytics-basic', 'analytics-advanced', 'group-management', 'creator-tools', 'monetization-features']
        }
    ];

    // Individual feature subscriptions
    const mockIndividualFeatures: IndividualFeature[] = [
        {
            id: 'analytics-basic',
            name: 'Basic Analytics',
            description: 'View post performance and engagement metrics',
            price: 2.99,
            currency: 'USD',
            interval: 'month',
            category: 'analytics',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace'],
            canBePurchasedSeparately: true,
            includedInPlans: ['oxy-insider', 'oxy-connect', 'oxy-premium', 'oxy-creator']
        },
        {
            id: 'analytics-advanced',
            name: 'Advanced Analytics',
            description: 'Detailed insights, trends, and audience demographics',
            price: 7.99,
            currency: 'USD',
            interval: 'month',
            category: 'analytics',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator', 'oxy-analytics'],
            canBePurchasedSeparately: true,
            includedInPlans: ['oxy-premium', 'oxy-creator']
        },
        {
            id: 'custom-themes',
            name: 'Custom Themes',
            description: 'Personalize your app with custom colors and layouts',
            price: 1.99,
            currency: 'USD',
            interval: 'month',
            category: 'customization',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator'],
            canBePurchasedSeparately: false, // Included in all plans
            includedInPlans: ['mention-plus', 'oxy-insider', 'oxy-connect', 'oxy-premium', 'oxy-creator']
        },
        {
            id: 'reading-mode-plus',
            name: 'Reading Mode Plus',
            description: 'Enhanced reading experience with focus modes',
            price: 1.99,
            currency: 'USD',
            interval: 'month',
            category: 'content',
            appScope: 'specific',
            applicableApps: ['mention', 'oxy-social'],
            canBePurchasedSeparately: false, // Included in all plans
            includedInPlans: ['mention-plus', 'oxy-insider', 'oxy-connect', 'oxy-premium', 'oxy-creator']
        },
        {
            id: 'group-management',
            name: 'Group Management',
            description: 'Create and manage private groups and communities',
            price: 4.99,
            currency: 'USD',
            interval: 'month',
            category: 'networking',
            appScope: 'ecosystem',
            applicableApps: ['mention', 'oxy-social', 'oxy-workspace'],
            canBePurchasedSeparately: true,
            includedInPlans: ['oxy-connect', 'oxy-premium', 'oxy-creator']
        },
        {
            id: 'creator-tools',
            name: 'Creator Tools Suite',
            description: 'Professional content creation and editing tools',
            price: 9.99,
            currency: 'USD',
            interval: 'month',
            category: 'productivity',
            appScope: 'specific',
            applicableApps: ['oxy-creator', 'oxy-studio'],
            canBePurchasedSeparately: true,
            includedInPlans: ['oxy-creator']
        },
        {
            id: 'monetization-features',
            name: 'Monetization Features',
            description: 'Revenue sharing, sponsorship tools, and creator fund access',
            price: 12.99,
            currency: 'USD',
            interval: 'month',
            category: 'productivity',
            appScope: 'specific',
            applicableApps: ['oxy-creator'],
            canBePurchasedSeparately: true,
            includedInPlans: ['oxy-creator']
        },
        {
            id: 'workspace-collaboration',
            name: 'Workspace Collaboration',
            description: 'Advanced team features and project management tools',
            price: 6.99,
            currency: 'USD',
            interval: 'month',
            category: 'productivity',
            appScope: 'specific',
            applicableApps: ['oxy-workspace'],
            canBePurchasedSeparately: true,
            includedInPlans: ['oxy-premium', 'oxy-creator']
        }
    ];

    useEffect(() => {
        detectCurrentApp();
    }, []);

    useEffect(() => {
        if (currentAppPackage) {
            loadSubscriptionData();
        }
    }, [currentAppPackage, user?.isPremium]);

    const detectCurrentApp = () => {
        // In a real implementation, this would detect the actual app package name
        // For now, we'll use a mock detection based on available methods

        // Real app detection methods you could use:
        // 1. Check bundle identifier in React Native: 
        //    import DeviceInfo from 'react-native-device-info';
        //    const bundleId = DeviceInfo.getBundleId();
        //    Example: com.oxy.mention -> 'mention'

        // 2. Environment variables or build configuration
        //    const appPackage = __DEV__ ? process.env.APP_PACKAGE : 'mention';

        // 3. Check specific app capabilities or modules
        //    if (typeof MentionModule !== 'undefined') return 'mention';
        //    if (typeof OxyWorkspaceModule !== 'undefined') return 'oxy-workspace';

        // 4. Use build-time configuration with Metro or similar
        //    const appPackage = require('../config/app.json').packageName;

        // For demo purposes, we'll simulate different apps
        // You would replace this with actual app detection logic

        // IMPORTANT: This ensures subscription restrictions work properly:
        // - Mention+ plan can only be subscribed to when app package == 'mention'
        // - Other app-specific plans follow the same pattern
        // - Ecosystem plans work across all apps

        const detectedApp = 'mention'; // This would be dynamic in real implementation

        setCurrentAppPackage(detectedApp);

        // Log for debugging
        console.log('Detected app package:', detectedApp);
        console.log('Available plans for this app will be filtered accordingly');
    };

    const loadSubscriptionData = async () => {
        try {
            setLoading(true);

            // Filter plans available for current app
            const availablePlans = mockPlans.filter(plan =>
                plan.applicableApps.includes(currentAppPackage)
            );
            setPlans(availablePlans);

            // Mock current subscription
            let currentSubscription: UserSubscription | null = null;
            if (user?.isPremium) {
                currentSubscription = {
                    id: 'sub_12345',
                    planId: 'oxy-insider',
                    status: 'active',
                    currentPeriodStart: new Date().toISOString(),
                    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    cancelAtPeriodEnd: false
                };
                setSubscription(currentSubscription);
            }

            // Filter features available for current app and update based on current subscription
            const availableFeatures = mockIndividualFeatures.filter(feature =>
                feature.applicableApps.includes(currentAppPackage)
            );

            const updatedFeatures = availableFeatures.map(feature => {
                const isIncludedInCurrentPlan = !!(currentSubscription &&
                    feature.includedInPlans.includes(currentSubscription.planId));

                return {
                    ...feature,
                    isIncludedInCurrentPlan,
                    isSubscribed: isIncludedInCurrentPlan ? true : false // Mock some individual subscriptions
                };
            });

            setIndividualFeatures(updatedFeatures);

        } catch (error) {
            console.error('Failed to load subscription data:', error);
            toast.error('Failed to load subscription information');
        } finally {
            setLoading(false);
        }
    };

    const handlePlanSelection = (planId: string) => {
        setSelectedPlan(planId);
    };

    const handleSubscribe = async (planId: string) => {
        try {
            // Check if plan is available for current app
            const selectedPlan = mockPlans.find(plan => plan.id === planId);
            if (!selectedPlan?.applicableApps.includes(currentAppPackage)) {
                console.log(`❌ Subscription blocked: Plan "${selectedPlan?.name}" not available for app "${currentAppPackage}"`);
                toast.error(t('premium.toasts.planUnavailable', { app: currentAppPackage }) || `This plan is not available for the current app (${currentAppPackage})`);
                return;
            }

            // Special restriction for Mention+ plan - only available in mention app
            if (planId === 'mention-plus' && currentAppPackage !== 'mention') {
                console.log(`❌ Subscription blocked: Mention+ plan requires app to be "mention", current app is "${currentAppPackage}"`);
                toast.error(t('premium.toasts.mentionOnly') || 'Mention+ is only available in the Mention app');
                return;
            }

            console.log(`✅ Subscription allowed: Plan "${selectedPlan.name}" is available for app "${currentAppPackage}"`);

            setProcessingPayment(true);

            // Mock payment processing
            await new Promise(resolve => setTimeout(resolve, 2000));

            toast.success(t('premium.toasts.activated') || 'Subscription activated successfully!');

            // Mock subscription update
            setSubscription({
                id: 'sub_' + Date.now(),
                planId,
                status: 'active',
                currentPeriodStart: new Date().toISOString(),
                currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                cancelAtPeriodEnd: false
            });

            // Reload data to update feature states
            loadSubscriptionData();

        } catch (error) {
            console.error('Payment failed:', error);
            toast.error(t('premium.toasts.paymentFailed') || 'Payment failed. Please try again.');
        } finally {
            setProcessingPayment(false);
        }
    };

    const handleCancelSubscription = () => {
        confirmAction(
            t('premium.confirms.cancelSub') || 'Are you sure you want to cancel your subscription? You will lose access to premium features at the end of your current billing period.',
            async () => {
                try {
                    // Mock cancellation
                    setSubscription(prev => prev ? {
                        ...prev,
                        cancelAtPeriodEnd: true
                    } : null);
                    toast.success(t('premium.toasts.willCancel') || 'Subscription will be canceled at the end of the billing period');
                } catch (error) {
                    toast.error(t('premium.toasts.cancelFailed') || 'Failed to cancel subscription');
                }
            }
        );
    };

    const handleReactivateSubscription = async () => {
        try {
            setSubscription(prev => prev ? {
                ...prev,
                cancelAtPeriodEnd: false
            } : null);
            toast.success(t('premium.toasts.reactivated') || 'Subscription reactivated successfully');
        } catch (error) {
            toast.error(t('premium.toasts.reactivateFailed') || 'Failed to reactivate subscription');
        }
    };

    const formatPrice = (price: number, currency: string, interval: string) => {
        const yearlyPrice = interval === 'year' ? price : price * 12 * 0.8; // 20% discount for yearly
        const displayPrice = billingInterval === 'year' ? yearlyPrice : price;

        return {
            price: displayPrice,
            formatted: `$${displayPrice.toFixed(2)}`,
            interval: billingInterval === 'year' ? 'year' : 'month'
        };
    };

    const getCurrentPlan = () => {
        if (!subscription) return null;
        return plans.find(plan => plan.id === subscription.planId);
    };

    const handleFeatureSubscribe = async (featureId: string) => {
        try {
            // Check if feature is available for current app
            const selectedFeature = mockIndividualFeatures.find(feature => feature.id === featureId);
            if (!selectedFeature?.applicableApps.includes(currentAppPackage)) {
                toast.error(`This feature is not available for the current app (${currentAppPackage})`);
                return;
            }

            // Special restrictions for app-specific features
            if (selectedFeature.appScope === 'specific') {
                // For features that are only available in specific apps, enforce strict matching
                const hasExactMatch = selectedFeature.applicableApps.length === 1 &&
                    selectedFeature.applicableApps[0] === currentAppPackage;
                if (!hasExactMatch && selectedFeature.applicableApps.length === 1) {
                    const requiredApp = selectedFeature.applicableApps[0];
                    toast.error(`${selectedFeature.name} is only available in the ${requiredApp} app`);
                    return;
                }
            }

            setProcessingPayment(true);

            // Mock feature subscription
            await new Promise(resolve => setTimeout(resolve, 1500));

            setIndividualFeatures(prev =>
                prev.map(feature =>
                    feature.id === featureId
                        ? { ...feature, isSubscribed: true }
                        : feature
                )
            );

            const feature = individualFeatures.find(f => f.id === featureId);
            toast.success((t('premium.toasts.featureSubscribed', { name: feature?.name ?? '' }) ?? `Subscribed to ${feature?.name} successfully!`));

        } catch (error) {
            console.error('Feature subscription failed:', error);
            toast.error(t('premium.toasts.featureSubscribeFailed') || 'Feature subscription failed. Please try again.');
        } finally {
            setProcessingPayment(false);
        }
    };

    const handleFeatureUnsubscribe = async (featureId: string) => {
        const feature = individualFeatures.find(f => f.id === featureId);
        confirmAction(
            (t('premium.confirms.unsubscribeFeature', { name: feature?.name ?? '' }) ?? `Are you sure you want to unsubscribe from ${feature?.name}?`),
            async () => {
                try {
                    setIndividualFeatures(prev =>
                        prev.map(f =>
                            f.id === featureId
                                ? { ...f, isSubscribed: false }
                                : f
                        )
                    );
                    toast.success((t('premium.toasts.featureUnsubscribed', { name: feature?.name ?? '' }) ?? `Unsubscribed from ${feature?.name}`));
                } catch (error) {
                    toast.error(t('premium.toasts.featureUnsubscribeFailed') || 'Failed to unsubscribe from feature');
                }
            }
        );
    };

    const renderHeader = () => {
        const getAppDisplayName = (packageName: string) => {
            const appNames: Record<string, string> = {
                'mention': 'Mention',
                'oxy-social': 'Oxy Social',
                'oxy-workspace': 'Oxy Workspace',
                'oxy-creator': 'Oxy Creator',
                'oxy-analytics': 'Oxy Analytics',
                'oxy-studio': 'Oxy Studio'
            };
            return appNames[packageName] || packageName;
        };

        return (
            <View style={[styles.header, { borderBottomColor: borderColor }]}>
                <TouchableOpacity style={styles.backButton} onPress={goBack}>
                    <Ionicons name="arrow-back" size={24} color={textColor} />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={[styles.headerTitle, { color: textColor }]}>{t('premium.title') || 'Oxy+ Subscriptions'}</Text>
                    <Text style={[styles.currentAppText, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        {t('premium.forApp', { app: getAppDisplayName(currentAppPackage) }) || `for ${getAppDisplayName(currentAppPackage)}`}
                    </Text>
                </View>
                {onClose && (
                    <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                        <Ionicons name="close" size={24} color={textColor} />
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    const renderCurrentSubscription = () => {
        if (!subscription) return null;

        const currentPlan = getCurrentPlan();
        if (!currentPlan) return null;

        const statusColor =
            subscription.status === 'active' ? successColor :
                subscription.status === 'trialing' ? warningColor :
                    dangerColor;

        return (
            <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: textColor }]}>{t('premium.current.title') || 'Current Subscription'}</Text>

                <View style={[styles.currentSubscriptionCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                    <View style={styles.subscriptionHeader}>
                        <View>
                            <Text style={[styles.planName, { color: textColor }]}>{currentPlan.name}</Text>
                            <Text style={[styles.planPrice, { color: primaryColor }]}>
                                ${currentPlan.price}/month
                            </Text>
                        </View>
                        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
                            <Text style={styles.statusText}>
                                {subscription.status.toUpperCase()}
                            </Text>
                        </View>
                    </View>

                    <Text style={[styles.subscriptionDetail, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        {t('premium.current.renewsOn', { date: new Date(subscription.currentPeriodEnd).toLocaleDateString() }) || `Renews on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
                    </Text>

                    {subscription.cancelAtPeriodEnd && (
                        <View style={styles.cancelNotice}>
                            <Ionicons name="warning" size={16} color={warningColor} />
                            <Text style={[styles.cancelText, { color: warningColor }]}>
                                {t('premium.current.willCancelOn', { date: new Date(subscription.currentPeriodEnd).toLocaleDateString() }) || `Subscription will cancel on ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`}
                            </Text>
                        </View>
                    )}

                    <View style={styles.subscriptionActions}>
                        {subscription.cancelAtPeriodEnd ? (
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: successColor }]}
                                onPress={handleReactivateSubscription}
                            >
                                <Text style={styles.actionButtonText}>{t('premium.actions.reactivate') || 'Reactivate'}</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity
                                style={[styles.actionButton, { backgroundColor: dangerColor }]}
                                onPress={handleCancelSubscription}
                            >
                                <Text style={styles.actionButtonText}>{t('premium.actions.cancelSubBtn') || 'Cancel Subscription'}</Text>
                            </TouchableOpacity>
                        )}

                        <TouchableOpacity
                            style={[styles.actionButton, styles.secondaryButton, { borderColor }]}

                        >
                            <Text style={[styles.actionButtonText, { color: textColor }]}>{t('premium.actions.manageBilling') || 'Manage Billing'}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        );
    };

    const renderBillingToggle = () => (
        <View style={styles.section}>
            <View style={styles.billingToggle}>
                <TouchableOpacity
                    style={[
                        styles.billingOption,
                        billingInterval === 'month' && { backgroundColor: primaryColor }
                    ]}
                    onPress={() => setBillingInterval('month')}
                >
                    <Text style={[
                        styles.billingOptionText,
                        { color: billingInterval === 'month' ? '#FFFFFF' : textColor }
                    ]}>
                        {t('premium.billing.monthly') || 'Monthly'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.billingOption,
                        billingInterval === 'year' && { backgroundColor: primaryColor }
                    ]}
                    onPress={() => setBillingInterval('year')}
                >
                    <Text style={[
                        styles.billingOptionText,
                        { color: billingInterval === 'year' ? '#FFFFFF' : textColor }
                    ]}>
                        {t('premium.billing.yearly') || 'Yearly'}
                    </Text>
                </TouchableOpacity>
            </View>

            {billingInterval === 'year' && (
                <Text style={[styles.savingsText, { color: successColor }]}>
                    {t('premium.billing.saveYearly') || '💰 Save 20% with yearly billing'}
                </Text>
            )}
        </View>
    );

    const renderPlanCard = (plan: SubscriptionPlan) => {
        const pricing = formatPrice(plan.price, plan.currency, plan.interval);
        const isSelected = selectedPlan === plan.id;
        const isCurrentPlan = subscription?.planId === plan.id;
        const isAppSpecific = plan.appScope === 'specific' && plan.applicableApps.length === 1;
        const isAvailableForCurrentApp = plan.applicableApps.includes(currentAppPackage);

        const getAppScopeText = () => {
            if (plan.appScope === 'ecosystem') {
                return t('premium.plan.scope.allApps') || 'Works across all Oxy apps';
            } else if (isAppSpecific) {
                const appName = plan.applicableApps[0];
                return t('premium.plan.scope.exclusive', { app: appName }) || `Exclusive to ${appName} app`;
            } else {
                return t('premium.plan.scope.availableIn', { apps: plan.applicableApps.join(', ') }) || `Available in: ${plan.applicableApps.join(', ')}`;
            }
        };

        const getAvailabilityStatus = () => {
            if (isAppSpecific && !isAvailableForCurrentApp) {
                const requiredApp = plan.applicableApps[0];
                return {
                    available: false,
                    reason: t('premium.plan.scope.exclusive', { app: requiredApp }) || `Only available in ${requiredApp} app`
                };
            }
            return { available: true, reason: null };
        };

        const availability = getAvailabilityStatus();

        return (
            <View
                key={plan.id}
                style={[
                    styles.planCard,
                    { backgroundColor: secondaryBackgroundColor, borderColor },
                    isSelected && { borderColor: primaryColor, borderWidth: 2 },
                    plan.isPopular && styles.popularPlan,
                    !availability.available && { opacity: 0.6 }
                ]}
            >
                {plan.isPopular && (
                    <View style={[styles.popularBadge, { backgroundColor: primaryColor }]}>
                        <Text style={styles.popularText}>MOST POPULAR</Text>
                    </View>
                )}

                {isAppSpecific && (
                    <View style={[styles.appSpecificBadge, {
                        backgroundColor: isAvailableForCurrentApp ? successColor : warningColor
                    }]}>
                        <Text style={styles.appSpecificText}>
                            {isAvailableForCurrentApp ? (t('premium.plan.badge.appExclusive') || 'App Exclusive') : (t('premium.plan.badge.notAvailable') || 'Not Available')}
                        </Text>
                    </View>
                )}

                <View style={styles.planHeader}>
                    <Text style={[styles.planName, { color: textColor }]}>{plan.name}</Text>
                    <Text style={[styles.planDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        {plan.description}
                    </Text>
                    <Text style={[styles.planAppScope, { color: isDarkTheme ? '#888888' : '#999999' }]}>
                        {getAppScopeText()}
                    </Text>
                    {!availability.available && (
                        <Text style={[styles.planRestrictionText, { color: dangerColor }]}>
                            {availability.reason}
                        </Text>
                    )}
                </View>

                <View style={styles.planPricing}>
                    <Text style={[styles.planPrice, { color: textColor }]}>
                        {pricing.formatted}
                    </Text>
                    <Text style={[styles.planInterval, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                        {t('premium.plan.perInterval', { interval: pricing.interval }) || `per ${pricing.interval}`}
                    </Text>
                </View>

                <View style={styles.planFeatures}>
                    {plan.features.map((feature, index) => (
                        <View key={index} style={styles.featureItem}>
                            <Ionicons name="checkmark" size={16} color={successColor} />
                            <Text style={[styles.featureText, { color: textColor }]}>{feature}</Text>
                        </View>
                    ))}
                </View>

                {isCurrentPlan ? (
                    <View style={[styles.currentPlanButton, { backgroundColor: successColor }]}>
                        <Text style={styles.currentPlanText}>{t('premium.plan.current') || 'Current Plan'}</Text>
                    </View>
                ) : !availability.available ? (
                    <View style={[styles.unavailablePlanButton, { backgroundColor: isDarkTheme ? '#444444' : '#E0E0E0' }]}>
                        <Text style={[styles.unavailablePlanText, { color: isDarkTheme ? '#888888' : '#999999' }]}>
                            {t('premium.plan.notAvailableInApp') || 'Not Available in Current App'}
                        </Text>
                    </View>
                ) : (
                    <TouchableOpacity
                        style={[
                            styles.selectPlanButton,
                            { backgroundColor: plan.isPopular ? primaryColor : borderColor }
                        ]}
                        onPress={() => handleSubscribe(plan.id)}
                        disabled={processingPayment}
                    >
                        {processingPayment ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <Text style={[
                                styles.selectPlanText,
                                { color: plan.isPopular ? '#FFFFFF' : textColor }
                            ]}>
                                {t('premium.actions.subscribeTo', { name: plan.name }) || `Subscribe to ${plan.name}`}
                            </Text>
                        )}
                    </TouchableOpacity>
                )}
            </View>
        );
    };

    const renderTabNavigation = () => (
        <View style={styles.section}>
            <View style={[styles.tabContainer, { borderBottomColor: borderColor }]}>
                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'plans' && { borderBottomColor: primaryColor, borderBottomWidth: 2 }
                    ]}
                    onPress={() => setActiveTab('plans')}
                >
                    <Text style={[
                        styles.tabText,
                        { color: activeTab === 'plans' ? primaryColor : textColor }
                    ]}>
                        {t('premium.tabs.plans') || 'Full Plans'}
                    </Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[
                        styles.tab,
                        activeTab === 'features' && { borderBottomColor: primaryColor, borderBottomWidth: 2 }
                    ]}
                    onPress={() => setActiveTab('features')}
                >
                    <Text style={[
                        styles.tabText,
                        { color: activeTab === 'features' ? primaryColor : textColor }
                    ]}>
                        {t('premium.tabs.features') || 'Individual Features'}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );

    const renderFeatureCard = (feature: IndividualFeature) => {
        const pricing = formatPrice(feature.price, feature.currency, feature.interval);
        const isSubscribed = feature.isSubscribed;
        const isIncludedInCurrentPlan = feature.isIncludedInCurrentPlan;
        const canPurchase = feature.canBePurchasedSeparately && !isIncludedInCurrentPlan;

        const getCategoryColor = (category: string) => {
            switch (category) {
                case 'analytics': return '#FF9500';
                case 'customization': return '#5856D6';
                case 'content': return '#30D158';
                case 'networking': return '#007AFF';
                case 'productivity': return '#FF3B30';
                default: return primaryColor;
            }
        };

        const getCategoryIcon = (category: string) => {
            switch (category) {
                case 'analytics': return 'analytics';
                case 'customization': return 'color-palette';
                case 'content': return 'document-text';
                case 'networking': return 'people';
                case 'productivity': return 'briefcase';
                default: return 'star';
            }
        };

        const getAppScopeText = () => {
            if (feature.appScope === 'ecosystem') {
                return t('premium.feature.scope.allApps');
            } else {
                return t('premium.feature.scope.availableIn', { apps: feature.applicableApps.join(', ') }) || `Available in: ${feature.applicableApps.join(', ')}`;
            }
        };

        return (
            <View
                key={feature.id}
                style={[
                    styles.featureCard,
                    { backgroundColor: secondaryBackgroundColor, borderColor },
                    isSubscribed && { borderColor: successColor, borderWidth: 2 },
                    isIncludedInCurrentPlan && { borderColor: primaryColor, borderWidth: 2 }
                ]}
            >
                <View style={styles.featureHeader}>
                    <View style={styles.featureIconContainer}>
                        <Ionicons
                            name={getCategoryIcon(feature.category) as any}
                            size={24}
                            color={getCategoryColor(feature.category)}
                        />
                    </View>
                    <View style={styles.featureInfo}>
                        <View style={styles.featureNameRow}>
                            <Text style={[styles.featureName, { color: textColor }]}>{feature.name}</Text>
                            {isIncludedInCurrentPlan && (
                                <View style={[styles.includedBadge, { backgroundColor: primaryColor }]}>
                                    <Text style={styles.includedBadgeText}>Included</Text>
                                </View>
                            )}
                        </View>
                        <Text style={[styles.featureDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {feature.description}
                        </Text>
                        <Text style={[styles.appScopeText, { color: isDarkTheme ? '#888888' : '#999999' }]}>
                            {getAppScopeText()}
                        </Text>
                    </View>
                </View>

                {!isIncludedInCurrentPlan && (
                    <View style={styles.featurePricing}>
                        <Text style={[styles.featurePrice, { color: textColor }]}>
                            {pricing.formatted}
                        </Text>
                        <Text style={[styles.featureInterval, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {t('premium.plan.perInterval', { interval: pricing.interval }) || `per ${pricing.interval}`}
                        </Text>
                    </View>
                )}

                {isIncludedInCurrentPlan ? (
                    <View style={[styles.includedInPlanButton, { backgroundColor: primaryColor }]}>
                        <Ionicons name="checkmark-circle" size={16} color="#FFFFFF" />
                        <Text style={styles.includedInPlanText}>{t('premium.feature.includedInPlan') || 'Included in your plan'}</Text>
                    </View>
                ) : isSubscribed ? (
                    <View style={styles.featureActions}>
                        <View style={[styles.subscribedButton, { backgroundColor: successColor }]}>
                            <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                            <Text style={styles.subscribedText}>{t('premium.feature.subscribed') || 'Subscribed'}</Text>
                        </View>
                        <TouchableOpacity
                            style={[styles.unsubscribeButton, { borderColor: dangerColor }]}
                            onPress={() => handleFeatureUnsubscribe(feature.id)}
                        >
                            <Text style={[styles.unsubscribeText, { color: dangerColor }]}>{t('premium.actions.unsubscribe') || 'Unsubscribe'}</Text>
                        </TouchableOpacity>
                    </View>
                ) : canPurchase ? (
                    <TouchableOpacity
                        style={[styles.subscribeFeatureButton, { backgroundColor: primaryColor }]}
                        onPress={() => handleFeatureSubscribe(feature.id)}
                        disabled={processingPayment}
                    >
                        {processingPayment ? (
                            <ActivityIndicator color="#FFFFFF" size="small" />
                        ) : (
                            <Text style={styles.subscribeFeatureText}>{t('premium.actions.subscribe') || 'Subscribe'}</Text>
                        )}
                    </TouchableOpacity>
                ) : (
                    <View style={[styles.unavailableButton, { backgroundColor: isDarkTheme ? '#444444' : '#E0E0E0' }]}>
                        <Text style={[styles.unavailableText, { color: isDarkTheme ? '#888888' : '#999999' }]}>
                            Only available in subscription plans
                        </Text>
                    </View>
                )}
            </View>
        );
    };

    const renderIndividualFeatures = () => {
        const categories = ['analytics', 'customization', 'content', 'networking', 'productivity'];

        return (
            <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: textColor }]}>Individual Features</Text>
                <Text style={[styles.sectionSubtitle, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                    Subscribe to specific features you need. Some features are included in subscription plans.
                </Text>

                {categories.map(category => {
                    const categoryFeatures = individualFeatures.filter(f => f.category === category);
                    if (categoryFeatures.length === 0) return null;

                    return (
                        <View key={category} style={styles.categorySection}>
                            <Text style={[styles.categoryTitle, { color: textColor }]}>
                                {category.charAt(0).toUpperCase() + category.slice(1)}
                            </Text>
                            {categoryFeatures.map(renderFeatureCard)}
                        </View>
                    );
                })}
            </View>
        );
    };

    // Add this for testing different app contexts (remove in production)
    const [showAppSwitcher, setShowAppSwitcher] = useState(__DEV__); // Only show in development

    const renderAppSwitcher = () => {
        if (!showAppSwitcher) return null;

        const testApps = ['mention', 'oxy-social', 'oxy-workspace', 'oxy-creator'];

        return (
            <View style={[styles.appSwitcher, { backgroundColor: isDarkTheme ? '#333333' : '#F0F0F0', borderColor }]}>
                <Text style={[styles.appSwitcherTitle, { color: textColor }]}>
                    🧪 Test App Context (Dev Only)
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.appSwitcherButtons}>
                        {testApps.map(app => (
                            <TouchableOpacity
                                key={app}
                                style={[
                                    styles.appSwitcherButton,
                                    {
                                        backgroundColor: currentAppPackage === app ? primaryColor : 'transparent',
                                        borderColor: primaryColor,
                                    }
                                ]}
                                onPress={() => {
                                    setCurrentAppPackage(app);
                                }}
                            >
                                <Text style={[
                                    styles.appSwitcherButtonText,
                                    { color: currentAppPackage === app ? '#FFFFFF' : textColor }
                                ]}>
                                    {app}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                </ScrollView>
            </View>
        );
    };

    if (loading) {
        return (
            <View style={[styles.container, { backgroundColor, justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={primaryColor} />
                <Text style={[styles.loadingText, { color: textColor }]}>{t('premium.loading') || 'Loading subscription plans...'}</Text>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor }]}>
            {renderHeader()}
            {renderAppSwitcher()}

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                {subscription && renderCurrentSubscription()}

                {!subscription && (
                    <View style={styles.section}>
                        <Text style={[styles.sectionTitle, { color: textColor }]}>{t('premium.choosePlan') || 'Choose Your Plan'}</Text>
                        <Text style={[styles.sectionSubtitle, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                            {t('premium.choosePlanSubtitle') || 'Unlock premium features and take your experience to the next level'}
                        </Text>
                    </View>
                )}

                {!subscription && renderTabNavigation()}

                {!subscription && activeTab === 'plans' && renderBillingToggle()}

                {activeTab === 'plans' ? (
                    <View style={styles.section}>
                        {!subscription && (
                            <Text style={[styles.sectionTitle, { color: textColor }]}>{t('premium.availablePlans') || 'Available Plans'}</Text>
                        )}

                        {plans.map(renderPlanCard)}
                    </View>
                ) : (
                    renderIndividualFeatures()
                )}

                {/* Features Comparison */}
                <View style={styles.section}>
                    <Text style={[styles.sectionTitle, { color: textColor }]}>{t('premium.why') || 'Why Go Premium?'}</Text>

                    <View style={[styles.benefitsCard, { backgroundColor: secondaryBackgroundColor, borderColor }]}>
                        <View style={styles.benefitItem}>
                            <Ionicons name="flash" size={24} color={primaryColor} />
                            <View style={styles.benefitContent}>
                                <Text style={[styles.benefitTitle, { color: textColor }]}>{t('premium.benefits.performance.title') || 'Enhanced Performance'}</Text>
                                <Text style={[styles.benefitDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    {t('premium.benefits.performance.desc') || 'Faster processing and priority access to our servers'}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.benefitItem}>
                            <Ionicons name="shield-checkmark" size={24} color={successColor} />
                            <View style={styles.benefitContent}>
                                <Text style={[styles.benefitTitle, { color: textColor }]}>{t('premium.benefits.security.title') || 'Advanced Security'}</Text>
                                <Text style={[styles.benefitDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    {t('premium.benefits.security.desc') || 'Enhanced encryption and security features'}
                                </Text>
                            </View>
                        </View>

                        <View style={styles.benefitItem}>
                            <Ionicons name="headset" size={24} color={warningColor} />
                            <View style={styles.benefitContent}>
                                <Text style={[styles.benefitTitle, { color: textColor }]}>{t('premium.benefits.support.title') || 'Priority Support'}</Text>
                                <Text style={[styles.benefitDescription, { color: isDarkTheme ? '#BBBBBB' : '#666666' }]}>
                                    {t('premium.benefits.support.desc') || 'Get help faster with our premium support team'}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                <View style={styles.bottomSpacing} />
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 16,
        borderBottomWidth: 1,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: 'center',
    },
    currentAppText: {
        fontSize: 14,
        marginTop: 2,
        fontStyle: 'italic',
    },
    closeButton: {
        padding: 8,
    },
    content: {
        flex: 1,
    },
    section: {
        padding: 20,
    },
    sectionTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        fontFamily: fontFamilies.phuduBold,
        marginBottom: 8,
    },
    sectionSubtitle: {
        fontSize: 16,
        lineHeight: 22,
        marginBottom: 20,
    },
    loadingText: {
        fontSize: 16,
        textAlign: 'center',
        marginTop: 16,
    },
    currentSubscriptionCard: {
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
    },
    subscriptionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    planName: {
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 4,
    },
    planPrice: {
        fontSize: 16,
        fontWeight: '600',
    },
    statusBadge: {
        paddingHorizontal: 12,
        paddingVertical: 4,
        borderRadius: 12,
    },
    statusText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
    subscriptionDetail: {
        fontSize: 14,
        marginBottom: 16,
    },
    cancelNotice: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        backgroundColor: 'rgba(255, 149, 0, 0.1)',
        borderRadius: 8,
        marginBottom: 16,
    },
    cancelText: {
        fontSize: 14,
        marginLeft: 8,
        flex: 1,
    },
    subscriptionActions: {
        flexDirection: 'row',
        gap: 12,
    },
    actionButton: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    secondaryButton: {
        backgroundColor: 'transparent',
        borderWidth: 1,
    },
    actionButtonText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    billingToggle: {
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.05)',
        borderRadius: 8,
        padding: 4,
        marginBottom: 12,
    },
    billingOption: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 6,
        alignItems: 'center',
    },
    billingOptionText: {
        fontSize: 16,
        fontWeight: '600',
    },
    savingsText: {
        fontSize: 14,
        textAlign: 'center',
        fontWeight: '600',
    },
    planCard: {
        borderRadius: 16,
        padding: 20,
        marginBottom: 16,
        borderWidth: 1,
        position: 'relative',
    },
    popularPlan: {
        borderWidth: 2,
    },
    popularBadge: {
        position: 'absolute',
        top: -1,
        left: 20,
        right: 20,
        paddingVertical: 8,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        alignItems: 'center',
    },
    popularText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: 'bold',
    },
    planHeader: {
        marginBottom: 16,
        marginTop: 16,
    },
    planDescription: {
        fontSize: 14,
        lineHeight: 20,
    },
    planAppScope: {
        fontSize: 12,
        fontStyle: 'italic',
        marginTop: 4,
    },
    planPricing: {
        flexDirection: 'row',
        alignItems: 'baseline',
        marginBottom: 20,
    },
    planInterval: {
        fontSize: 14,
        marginLeft: 4,
    },
    planFeatures: {
        marginBottom: 24,
    },
    featureItem: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    featureText: {
        fontSize: 14,
        marginLeft: 8,
        flex: 1,
    },
    selectPlanButton: {
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    selectPlanText: {
        fontSize: 16,
        fontWeight: '600',
    },
    currentPlanButton: {
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    currentPlanText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    benefitsCard: {
        borderRadius: 16,
        padding: 20,
        borderWidth: 1,
    },
    benefitItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 20,
    },
    benefitContent: {
        marginLeft: 16,
        flex: 1,
    },
    benefitTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    benefitDescription: {
        fontSize: 14,
        lineHeight: 20,
    },
    bottomSpacing: {
        height: 40,
    },
    // Tab Navigation Styles
    tabContainer: {
        flexDirection: 'row',
        borderBottomWidth: 1,
        marginBottom: 20,
    },
    tab: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: 'center',
    },
    tabText: {
        fontSize: 16,
        fontWeight: '600',
    },
    // Individual Feature Styles
    featureCard: {
        borderRadius: 12,
        borderWidth: 1,
        padding: 16,
        marginBottom: 12,
    },
    featureHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 12,
    },
    featureIconContainer: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(0, 122, 255, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    featureInfo: {
        flex: 1,
    },
    featureName: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    featureDescription: {
        fontSize: 14,
        lineHeight: 20,
    },
    featurePricing: {
        alignItems: 'center',
        marginBottom: 16,
    },
    featurePrice: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    featureInterval: {
        fontSize: 14,
        marginTop: 2,
    },
    featureActions: {
        flexDirection: 'row',
        gap: 8,
    },
    subscribedButton: {
        flex: 1,
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 12,
        borderRadius: 8,
        gap: 6,
    },
    subscribedText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    unsubscribeButton: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 12,
        borderRadius: 8,
        borderWidth: 1,
    },
    unsubscribeText: {
        fontSize: 16,
        fontWeight: '600',
    },
    subscribeFeatureButton: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 12,
        borderRadius: 8,
    },
    subscribeFeatureText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    categorySection: {
        marginBottom: 24,
    },
    categoryTitle: {
        fontSize: 18,
        fontWeight: '600',
        marginBottom: 12,
    },
    // New styles for enhanced feature cards
    featureNameRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    includedBadge: {
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 12,
        marginLeft: 8,
    },
    includedBadgeText: {
        color: '#FFFFFF',
        fontSize: 10,
        fontWeight: '600',
        textTransform: 'uppercase',
    },
    appScopeText: {
        fontSize: 12,
        marginTop: 4,
        fontStyle: 'italic',
    },
    includedInPlanButton: {
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 12,
        borderRadius: 8,
        gap: 6,
    },
    includedInPlanText: {
        color: '#FFFFFF',
        fontSize: 14,
        fontWeight: '600',
    },
    unavailableButton: {
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 12,
        borderRadius: 8,
    },
    unavailableText: {
        fontSize: 14,
        fontWeight: '500',
        textAlign: 'center',
    },
    // App-specific plan styles
    appSpecificBadge: {
        position: 'absolute',
        top: 16,
        right: 16,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 12,
        zIndex: 1,
    },
    appSpecificText: {
        color: '#FFFFFF',
        fontSize: 12,
        fontWeight: '600',
    },
    planRestrictionText: {
        fontSize: 12,
        fontWeight: '500',
        marginTop: 4,
        fontStyle: 'italic',
    },
    unavailablePlanButton: {
        paddingVertical: 16,
        borderRadius: 12,
        alignItems: 'center',
    },
    unavailablePlanText: {
        fontSize: 16,
        fontWeight: '600',
    },
    // App switcher styles (for development/testing)
    appSwitcher: {
        padding: 16,
        borderBottomWidth: 1,
        margin: 16,
        borderRadius: 12,
        borderWidth: 1,
    },
    appSwitcherTitle: {
        fontSize: 14,
        fontWeight: '600',
        marginBottom: 12,
    },
    appSwitcherButtons: {
        flexDirection: 'row',
        gap: 8,
    },
    appSwitcherButton: {
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 8,
        borderWidth: 1,
    },
    appSwitcherButtonText: {
        fontSize: 12,
        fontWeight: '500',
    },
});

export default PremiumSubscriptionScreen;
