import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ActivityIndicator,
    Platform,
    KeyboardAvoidingView,
    ScrollView,
    Animated,
    StatusBar,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { useThemeColors } from '../styles';
import { normalizeTheme } from '../utils/themeUtils';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { packageInfo } from '../../constants/version';
import { GroupedSection } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useOxy } from '../context/OxyContext';

import {
    FormInput,
    ProgressIndicator,
    useFeedbackForm,
    createFeedbackStyles,
    FEEDBACK_TYPES,
    PRIORITY_LEVELS,
    CATEGORIES,
} from '../components/feedback';

const FeedbackScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onClose,
    theme,
}) => {
    const { user, oxyServices } = useOxy();
    const normalizedTheme = normalizeTheme(theme);
    const colors = useThemeColors(normalizedTheme);
    const { t } = useI18n();

    const { feedbackData, feedbackState, setFeedbackState, updateField, resetForm } = useFeedbackForm();

    const [currentStep, setCurrentStep] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');

    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;

    const styles = useMemo(() => createFeedbackStyles(colors as any), [colors]);

    const animateTransition = useCallback((nextStep: number) => {
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 250,
            useNativeDriver: Platform.OS !== 'web',
        }).start(() => {
            setCurrentStep(nextStep);
            slideAnim.setValue(-100);

            Animated.parallel([
                Animated.timing(fadeAnim, {
                    toValue: 1,
                    duration: 250,
                    useNativeDriver: Platform.OS !== 'web',
                }),
                Animated.timing(slideAnim, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: Platform.OS !== 'web',
                })
            ]).start();
        });
    }, [fadeAnim, slideAnim]);

    const nextStep = useCallback(() => {
        if (currentStep < 3) {
            animateTransition(currentStep + 1);
        }
    }, [currentStep, animateTransition]);

    const prevStep = useCallback(() => {
        if (currentStep > 0) {
            animateTransition(currentStep - 1);
        }
    }, [currentStep, animateTransition]);

    const isTypeStepValid = useCallback(() => {
        return feedbackData.type && feedbackData.category;
    }, [feedbackData.type, feedbackData.category]);

    const isDetailsStepValid = useCallback(() => {
        return feedbackData.title.trim() && feedbackData.description.trim();
    }, [feedbackData.title, feedbackData.description]);

    const isContactStepValid = useCallback(() => {
        return feedbackData.contactEmail.trim() || user?.email;
    }, [feedbackData.contactEmail, user?.email]);

    const handleSubmitFeedback = useCallback(async () => {
        if (!isTypeStepValid() || !isDetailsStepValid() || !isContactStepValid()) {
            toast.error(t('feedback.toasts.fillRequired') || 'Please fill in all required fields');
            return;
        }

        try {
            setFeedbackState({ status: 'submitting', message: '' });
            setErrorMessage('');

            const feedbackPayload = {
                type: feedbackData.type,
                title: feedbackData.title,
                description: feedbackData.description,
                priority: feedbackData.priority,
                category: feedbackData.category,
                contactEmail: feedbackData.contactEmail || user?.email,
                systemInfo: feedbackData.systemInfo ? {
                    platform: Platform.OS,
                    version: Platform.Version?.toString() || 'Unknown',
                    appVersion: packageInfo.version,
                    userId: user?.id,
                    username: user?.username,
                    timestamp: new Date().toISOString(),
                } : undefined,
            };

            await oxyServices.submitFeedback(feedbackPayload);

            setFeedbackState({ status: 'success', message: t('feedback.toasts.submitSuccess') || 'Feedback submitted successfully!' });
            toast.success(t('feedback.toasts.thanks') || 'Thank you for your feedback!');

            setTimeout(() => {
                resetForm();
                setCurrentStep(0);
            }, 3000);

        } catch (error: any) {
            setFeedbackState({ status: 'error', message: error.message || (t('feedback.toasts.submitFailed') || 'Failed to submit feedback') });
            toast.error(error.message || (t('feedback.toasts.submitFailed') || 'Failed to submit feedback'));
        }
    }, [feedbackData, user, isTypeStepValid, isDetailsStepValid, isContactStepValid, resetForm, setFeedbackState, t]);

    const feedbackTypeItems = useMemo(() => FEEDBACK_TYPES.map(type => ({
        id: type.id,
        icon: type.icon,
        iconColor: type.color,
        title: type.label,
        subtitle: type.description,
        onPress: () => { updateField('type', type.id as any); updateField('category', ''); },
        selected: feedbackData.type === type.id,
        showChevron: false,
        multiRow: true,
        dense: true,
    })), [feedbackData.type, updateField]);

    const categoryItems = useMemo(() => (feedbackData.type ? (CATEGORIES[feedbackData.type] || []).map(cat => ({
        id: cat,
        icon: feedbackData.category === cat ? 'check-circle' : 'ellipse-outline',
        iconColor: feedbackData.category === cat ? colors.primary : colors.secondaryText,
        title: cat,
        onPress: () => updateField('category', cat),
        selected: feedbackData.category === cat,
        showChevron: false,
        dense: true,
    })) : []), [feedbackData.type, feedbackData.category, colors.primary, colors.secondaryText, updateField]);

    const priorityItems = useMemo(() => PRIORITY_LEVELS.map(p => ({
        id: p.id,
        icon: p.icon,
        iconColor: p.color,
        title: p.label,
        onPress: () => updateField('priority', p.id as any),
        selected: feedbackData.priority === p.id,
        showChevron: false,
        dense: true,
    })), [feedbackData.priority, updateField]);

    const renderTypeStep = () => (
        <Animated.View style={[styles.stepContainer, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    {t('feedback.type.title') || 'What type of feedback?'}
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    {t('feedback.type.subtitle') || 'Choose the category that best describes your feedback'}
                </Text>
            </View>
            <View style={styles.fullBleed}>
                <GroupedSection items={feedbackTypeItems} />
            </View>

            {feedbackData.type && (
                <View style={styles.categoryContainer}>
                    <Text style={[styles.modernLabel, { color: colors.secondaryText, marginBottom: 8 }]}>
                        {t('feedback.category.label') || 'Category'}
                    </Text>
                    <View style={styles.fullBleed}>
                        <GroupedSection items={categoryItems} />
                    </View>
                </View>
            )}

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, { backgroundColor: 'transparent', borderColor: colors.border, borderRadius: 35 }]}
                    onPress={goBack}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>{t('common.actions.back') || 'Back'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, { backgroundColor: colors.primary, borderColor: colors.primary, borderRadius: 35 }]}
                    onPress={nextStep}
                    disabled={!isTypeStepValid()}
                    accessibilityRole="button"
                    accessibilityLabel="Continue to next step"
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>{t('common.actions.next') || 'Next'}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderDetailsStep = () => (
        <Animated.View style={[styles.stepContainer, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    {t('feedback.details.title') || 'Tell us more'}
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    {t('feedback.details.subtitle') || 'Provide details about your feedback'}
                </Text>
            </View>

            <FormInput
                icon="create-outline"
                label={t('feedback.fields.title.label') || 'Title'}
                value={feedbackData.title}
                onChangeText={(text) => { updateField('title', text); setErrorMessage(''); }}
                placeholder={t('feedback.fields.title.placeholder') || 'Brief summary of your feedback'}
                testID="feedback-title-input"
                colors={colors as any}
                styles={styles}
                accessibilityLabel="Feedback title"
                accessibilityHint="Enter a brief summary of your feedback"
            />

            <FormInput
                icon="document-text-outline"
                label={t('feedback.fields.description.label') || 'Description'}
                value={feedbackData.description}
                onChangeText={(text) => { updateField('description', text); setErrorMessage(''); }}
                placeholder={t('feedback.fields.description.placeholder') || 'Please provide detailed information...'}
                multiline={true}
                numberOfLines={6}
                testID="feedback-description-input"
                colors={colors as any}
                styles={styles}
                accessibilityLabel="Feedback description"
                accessibilityHint="Provide detailed information about your feedback"
            />

            <View style={{ marginBottom: 24 }}>
                <Text style={[styles.modernLabel, { color: colors.secondaryText, marginBottom: 8 }]}>
                    {t('feedback.priority.label') || 'Priority Level'}
                </Text>
                <View style={styles.fullBleed}>
                    <GroupedSection items={priorityItems} />
                </View>
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton, { borderColor: colors.border }]}
                    onPress={prevStep}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>{t('common.actions.back') || 'Back'}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={nextStep}
                    disabled={!isDetailsStepValid()}
                    accessibilityRole="button"
                    accessibilityLabel="Continue to next step"
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>{t('common.actions.next') || 'Next'}</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderContactStep = () => (
        <Animated.View style={[styles.stepContainer, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    {t('feedback.contact.title') || 'Contact Information'}
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    {t('feedback.contact.subtitle') || 'Help us get back to you'}
                </Text>
            </View>

            <FormInput
                icon="mail-outline"
                label={t('feedback.fields.email.label') || 'Email Address'}
                value={feedbackData.contactEmail}
                onChangeText={(text) => { updateField('contactEmail', text); setErrorMessage(''); }}
                placeholder={user?.email || (t('feedback.fields.email.placeholder') || 'Enter your email address')}
                testID="feedback-email-input"
                colors={colors as any}
                styles={styles}
                accessibilityLabel="Email address"
                accessibilityHint="Enter your email so we can respond"
            />

            <View style={styles.checkboxContainer}>
                <TouchableOpacity
                    style={[
                        styles.checkbox,
                        {
                            borderColor: feedbackData.systemInfo ? colors.primary : colors.border,
                            backgroundColor: feedbackData.systemInfo ? colors.primary : 'transparent',
                        }
                    ]}
                    onPress={() => updateField('systemInfo', !feedbackData.systemInfo)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: feedbackData.systemInfo }}
                    accessibilityLabel="Include system information"
                >
                    {feedbackData.systemInfo && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                </TouchableOpacity>
                <Text style={[styles.checkboxText, { color: colors.text }]}>
                    {t('feedback.contact.includeSystemInfo') || 'Include system information to help us better understand your issue'}
                </Text>
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton, { borderColor: colors.border }]}
                    onPress={prevStep}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}
                    onPress={nextStep}
                    disabled={!isContactStepValid()}
                    accessibilityRole="button"
                    accessibilityLabel="Continue to summary"
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>Next</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderSummaryStep = () => (
        <Animated.View style={[styles.stepContainer, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    {t('feedback.summary.title') || 'Summary'}
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    {t('feedback.summary.subtitle') || 'Please review your feedback before submitting'}
                </Text>
            </View>

            <View style={styles.summaryContainer}>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Type:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>
                        {FEEDBACK_TYPES.find(t => t.id === feedbackData.type)?.label}
                    </Text>
                </View>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Category:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{feedbackData.category}</Text>
                </View>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Priority:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>
                        {PRIORITY_LEVELS.find(p => p.id === feedbackData.priority)?.label}
                    </Text>
                </View>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Title:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>{feedbackData.title}</Text>
                </View>
                <View style={styles.summaryRow}>
                    <Text style={[styles.summaryLabel, { color: colors.secondaryText }]}>Contact:</Text>
                    <Text style={[styles.summaryValue, { color: colors.text }]}>
                        {feedbackData.contactEmail || user?.email}
                    </Text>
                </View>
            </View>

            <TouchableOpacity
                style={[styles.button, { backgroundColor: colors.primary }]}
                onPress={handleSubmitFeedback}
                disabled={feedbackState.status === 'submitting'}
                testID="submit-feedback-button"
                accessibilityRole="button"
                accessibilityLabel="Submit feedback"
            >
                {feedbackState.status === 'submitting' ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <>
                        <Text style={styles.buttonText}>{t('feedback.actions.submit') || 'Submit Feedback'}</Text>
                        <Ionicons name="send" size={20} color="#FFFFFF" />
                    </>
                )}
            </TouchableOpacity>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, { backgroundColor: 'transparent', borderColor: colors.border, borderRadius: 35 }]}
                    onPress={prevStep}
                    accessibilityRole="button"
                    accessibilityLabel="Go back"
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>{t('common.actions.back') || 'Back'}</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderSuccessStep = () => (
        <Animated.View style={[styles.stepContainer, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
            <View style={styles.successContainer}>
                <View style={[styles.successIcon, { backgroundColor: (colors.success || '#34C759') + '20', padding: 24, borderRadius: 50 }]}>
                    <Ionicons name="checkmark-circle" size={48} color={colors.success || '#34C759'} />
                </View>
                <Text style={[styles.successTitle, { color: colors.text }]}>
                    {t('feedback.success.thanks') || 'Thank You!'}
                </Text>
                <Text style={[styles.successMessage, { color: colors.secondaryText }]}>
                    {t('feedback.success.message') || "Your feedback has been submitted successfully. We'll review it and get back to you soon."}
                </Text>
                <TouchableOpacity
                    style={[styles.button, { backgroundColor: colors.primary }]}
                    onPress={() => { resetForm(); setCurrentStep(0); }}
                    accessibilityRole="button"
                    accessibilityLabel="Submit another feedback"
                >
                    <Text style={styles.buttonText}>{t('feedback.actions.submitAnother') || 'Submit Another'}</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    );

    const renderCurrentStep = () => {
        if (feedbackState.status === 'success') return renderSuccessStep();
        switch (currentStep) {
            case 0: return renderTypeStep();
            case 1: return renderDetailsStep();
            case 2: return renderContactStep();
            case 3: return renderSummaryStep();
            default: return renderTypeStep();
        }
    };

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: theme === 'dark' ? colors.background : '#F7F9FC' }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={theme === 'dark' ? colors.background : '#F7F9FC'}
            />

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { backgroundColor: 'transparent' }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {feedbackState.status !== 'success' && (
                    <ProgressIndicator currentStep={currentStep} totalSteps={4} colors={colors as any} styles={styles} />
                )}
                {renderCurrentStep()}
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

export default FeedbackScreen;
