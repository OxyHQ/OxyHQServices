import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    ActivityIndicator,
    Platform,
    KeyboardAvoidingView,
    ScrollView,
    Animated,
    StatusBar,
    Alert,
    Dimensions,
} from 'react-native';
import type { BaseScreenProps } from '../navigation/types';
import { useOxy } from '../context/OxyContext';
import { useThemeColors } from '../styles';
import { Ionicons } from '@expo/vector-icons';
import { toast } from '../../lib/sonner';
import { packageInfo } from '../../constants/version';

// Types for better type safety
interface FeedbackData {
    type: 'bug' | 'feature' | 'general' | 'support';
    title: string;
    description: string;
    priority: 'low' | 'medium' | 'high' | 'critical';
    category: string;
    contactEmail: string;
    systemInfo: boolean;
}

interface FeedbackState {
    status: 'idle' | 'submitting' | 'success' | 'error';
    message: string;
}

// Constants
const FEEDBACK_TYPES = [
    { id: 'bug', label: 'Bug Report', icon: 'bug', color: '#FF3B30', description: 'Report a problem or issue' },
    { id: 'feature', label: 'Feature Request', icon: 'bulb', color: '#007AFF', description: 'Suggest a new feature' },
    { id: 'general', label: 'General Feedback', icon: 'chatbubble', color: '#34C759', description: 'Share your thoughts' },
    { id: 'support', label: 'Support Request', icon: 'help-circle', color: '#FF9500', description: 'Get help with something' },
];

const PRIORITY_LEVELS = [
    { id: 'low', label: 'Low', icon: 'arrow-down', color: '#34C759' },
    { id: 'medium', label: 'Medium', icon: 'remove', color: '#FF9500' },
    { id: 'high', label: 'High', icon: 'arrow-up', color: '#FF3B30' },
    { id: 'critical', label: 'Critical', icon: 'warning', color: '#FF0000' },
];

const CATEGORIES = {
    bug: ['UI/UX', 'Performance', 'Authentication', 'File Management', 'Billing', 'Other'],
    feature: ['User Interface', 'File Management', 'Security', 'Performance', 'Integration', 'Other'],
    general: ['User Experience', 'Design', 'Performance', 'Documentation', 'Other'],
    support: ['Account Issues', 'Billing', 'Technical Problems', 'Feature Questions', 'Other'],
};

// Styles factory function
const createStyles = (colors: any, theme: string) => StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 24,
        paddingTop: 40,
        paddingBottom: 20,
    },
    stepContainer: {
        flex: 1,
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
    },
    modernHeader: {
        alignItems: 'flex-start',
        width: '100%',
        marginBottom: 24,
    },
    modernTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 42,
        lineHeight: 48,
        marginBottom: 12,
        textAlign: 'left',
        letterSpacing: -1,
    },
    modernSubtitle: {
        fontSize: 18,
        lineHeight: 24,
        textAlign: 'left',
        opacity: 0.8,
        marginBottom: 24,
    },
    stepTitle: {
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
        fontWeight: Platform.OS === 'web' ? 'bold' : undefined,
        fontSize: 42,
        lineHeight: 48,
        marginBottom: 12,
        textAlign: 'left',
        letterSpacing: -1,
    },
    inputContainer: {
        width: '100%',
        marginBottom: 24,
    },
    premiumInputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 56,
        borderRadius: 16,
        paddingHorizontal: 20,
        borderWidth: 2,
        backgroundColor: colors.inputBackground,
    },
    textAreaWrapper: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        minHeight: 120,
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderWidth: 2,
        backgroundColor: colors.inputBackground,
    },
    inputIcon: {
        marginRight: 12,
    },
    inputContent: {
        flex: 1,
    },
    modernLabel: {
        fontSize: 12,
        fontWeight: '500',
        marginBottom: 2,
    },
    modernInput: {
        flex: 1,
        fontSize: 16,
        height: '100%',
    },
    textArea: {
        flex: 1,
        fontSize: 16,
        textAlignVertical: 'top',
        minHeight: 80,
    },
    typeGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 12,
        marginBottom: 24,
    },
    typeCard: {
        width: (Dimensions.get('window').width - 72) / 2,
        padding: 20,
        borderRadius: 16,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 120,
    },
    typeIcon: {
        marginBottom: 12,
    },
    typeLabel: {
        fontSize: 16,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 4,
    },
    typeDescription: {
        fontSize: 12,
        textAlign: 'center',
        opacity: 0.8,
    },
    priorityContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 24,
    },
    priorityButton: {
        flex: 1,
        padding: 16,
        borderRadius: 12,
        borderWidth: 2,
        alignItems: 'center',
        marginHorizontal: 4,
    },
    priorityLabel: {
        fontSize: 12,
        fontWeight: '600',
        marginTop: 4,
    },
    categoryContainer: {
        marginBottom: 24,
    },
    categoryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        borderWidth: 1,
        marginBottom: 8,
    },
    categoryText: {
        fontSize: 16,
        marginLeft: 12,
    },
    checkboxContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        marginRight: 12,
        alignItems: 'center',
        justifyContent: 'center',
    },
    checkboxText: {
        fontSize: 16,
        flex: 1,
    },
    button: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 18,
        paddingHorizontal: 32,
        borderRadius: 16,
        marginVertical: 8,
        gap: 8,
        width: '100%',
        ...Platform.select({
            web: {
                boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
            },
            default: {
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 6,
            }
        }),
    },
    buttonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        letterSpacing: 0.5,
    },
    navigationButtons: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginTop: 16,
        marginBottom: 8,
        width: '100%',
        gap: 8,
    },
    navButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 6,
        paddingHorizontal: 12,
        gap: 6,
        minWidth: 70,
        borderWidth: 1,
        ...Platform.select({
            web: {
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            },
            default: {
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.1,
                shadowRadius: 4,
                elevation: 2,
            }
        }),
    },
    backButton: {
        backgroundColor: 'transparent',
        borderTopLeftRadius: 35,
        borderBottomLeftRadius: 35,
        borderTopRightRadius: 12,
        borderBottomRightRadius: 12,
    },
    nextButton: {
        backgroundColor: 'transparent',
        borderTopRightRadius: 35,
        borderBottomRightRadius: 35,
        borderTopLeftRadius: 12,
        borderBottomLeftRadius: 12,
    },
    navButtonText: {
        fontSize: 13,
        fontWeight: '500',
    },
    progressContainer: {
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 20,
        marginTop: 8,
    },
    progressDot: {
        height: 10,
        width: 10,
        borderRadius: 5,
        marginHorizontal: 6,
        borderWidth: 2,
        borderColor: '#fff',
        ...Platform.select({
            web: {
                boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
            },
            default: {
                shadowColor: colors.primary,
                shadowOpacity: 0.08,
                shadowOffset: { width: 0, height: 1 },
                shadowRadius: 2,
                elevation: 1,
            }
        }),
    },
    summaryContainer: {
        padding: 0,
        marginBottom: 24,
        width: '100%',
    },
    summaryRow: {
        flexDirection: 'row',
        marginBottom: 10,
    },
    summaryLabel: {
        fontSize: 15,
        width: 90,
    },
    summaryValue: {
        fontSize: 15,
        fontWeight: '600',
        flex: 1,
    },
    successContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
    },
    successIcon: {
        marginBottom: 24,
    },
    successTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 12,
        textAlign: 'center',
    },
    successMessage: {
        fontSize: 16,
        textAlign: 'center',
        opacity: 0.8,
        marginBottom: 24,
    },
});

// Custom hooks for better separation of concerns
const useFeedbackForm = () => {
    const [feedbackData, setFeedbackData] = useState<FeedbackData>({
        type: 'general',
        title: '',
        description: '',
        priority: 'medium',
        category: '',
        contactEmail: '',
        systemInfo: true,
    });

    const [feedbackState, setFeedbackState] = useState<FeedbackState>({
        status: 'idle',
        message: ''
    });

    const updateField = useCallback((field: keyof FeedbackData, value: any) => {
        setFeedbackData(prev => ({ ...prev, [field]: value }));
    }, []);

    const resetForm = useCallback(() => {
        setFeedbackData({
            type: 'general',
            title: '',
            description: '',
            priority: 'medium',
            category: '',
            contactEmail: '',
            systemInfo: true,
        });
        setFeedbackState({ status: 'idle', message: '' });
    }, []);

    return {
        feedbackData,
        feedbackState,
        setFeedbackState,
        updateField,
        resetForm
    };
};

// Reusable components
const FormInput: React.FC<{
    icon: string;
    label: string;
    value: string;
    onChangeText: (text: string) => void;
    placeholder?: string;
    multiline?: boolean;
    numberOfLines?: number;
    testID?: string;
    colors: any;
    styles: any;
    borderColor?: string;
}> = React.memo(({
    icon,
    label,
    value,
    onChangeText,
    placeholder,
    multiline = false,
    numberOfLines = 1,
    testID,
    colors,
    styles,
    borderColor,
}) => (
    <View style={styles.inputContainer}>
        <View style={[
            multiline ? styles.textAreaWrapper : styles.premiumInputWrapper,
            {
                borderColor: borderColor || colors.border,
                backgroundColor: colors.inputBackground,
                shadowColor: colors.primary,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.1,
                shadowRadius: 12,
                elevation: 3,
            }
        ]}>
            {!multiline && (
                <Ionicons
                    name={icon as any}
                    size={22}
                    color={colors.secondaryText}
                    style={styles.inputIcon}
                />
            )}
            <View style={styles.inputContent}>
                <Text style={[styles.modernLabel, { color: colors.secondaryText }]}>
                    {label}
                </Text>
                <TextInput
                    style={[
                        multiline ? styles.textArea : styles.modernInput,
                        { color: colors.text }
                    ]}
                    value={value}
                    onChangeText={onChangeText}
                    placeholder={placeholder}
                    placeholderTextColor={colors.secondaryText + '60'}
                    multiline={multiline}
                    numberOfLines={multiline ? numberOfLines : undefined}
                    testID={testID}
                />
            </View>
        </View>
    </View>
));

const ProgressIndicator: React.FC<{ currentStep: number; totalSteps: number; colors: any; styles: any }> = React.memo(({ currentStep, totalSteps, colors, styles }) => (
    <View style={styles.progressContainer}>
        {Array.from({ length: totalSteps }, (_, index) => (
            <View
                key={index}
                style={[
                    styles.progressDot,
                    currentStep === index ?
                        { backgroundColor: colors.primary, width: 24 } :
                        { backgroundColor: colors.border }
                ]}
            />
        ))}
    </View>
));

// Main component
const FeedbackScreen: React.FC<BaseScreenProps> = ({
    navigate,
    goBack,
    onClose,
    theme,
}) => {
    const { user, oxyServices } = useOxy();
    const colors = useThemeColors(theme);

    // Form state
    const { feedbackData, feedbackState, setFeedbackState, updateField, resetForm } = useFeedbackForm();

    // UI state
    const [currentStep, setCurrentStep] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');

    // Animation refs
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;

    // Memoized styles
    const styles = useMemo(() => createStyles(colors, theme), [colors, theme]);

    // Animation functions
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

    // Form validation helpers
    const isTypeStepValid = useCallback(() => {
        return feedbackData.type && feedbackData.category;
    }, [feedbackData.type, feedbackData.category]);

    const isDetailsStepValid = useCallback(() => {
        return feedbackData.title.trim() && feedbackData.description.trim();
    }, [feedbackData.title, feedbackData.description]);

    const isContactStepValid = useCallback(() => {
        return feedbackData.contactEmail.trim() || user?.email;
    }, [feedbackData.contactEmail, user?.email]);

    // Submit feedback handler
    const handleSubmitFeedback = useCallback(async () => {
        if (!isTypeStepValid() || !isDetailsStepValid() || !isContactStepValid()) {
            toast.error('Please fill in all required fields');
            return;
        }

        try {
            setFeedbackState({ status: 'submitting', message: '' });
            setErrorMessage('');

            // Prepare feedback data
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

            // For now, we'll simulate the API call
            // In a real implementation, you would call oxyServices.submitFeedback(feedbackPayload)
            await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate API call

            setFeedbackState({ status: 'success', message: 'Feedback submitted successfully!' });
            toast.success('Thank you for your feedback!');

            // Reset form after success
            setTimeout(() => {
                resetForm();
                setCurrentStep(0);
            }, 3000);

        } catch (error: any) {
            setFeedbackState({ status: 'error', message: error.message || 'Failed to submit feedback' });
            toast.error(error.message || 'Failed to submit feedback');
        }
    }, [feedbackData, user, isTypeStepValid, isDetailsStepValid, isContactStepValid, resetForm]);

    // Step components
    const renderTypeStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    What type of feedback?
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Choose the category that best describes your feedback
                </Text>
            </View>

            <View style={styles.typeGrid}>
                {FEEDBACK_TYPES.map((type) => (
                    <TouchableOpacity
                        key={type.id}
                        style={[
                            styles.typeCard,
                            {
                                borderColor: feedbackData.type === type.id ? type.color : colors.border,
                                backgroundColor: feedbackData.type === type.id ? type.color + '10' : colors.inputBackground,
                            }
                        ]}
                        onPress={() => {
                            updateField('type', type.id);
                            updateField('category', '');
                        }}
                    >
                        <View style={[styles.typeIcon, { backgroundColor: type.color + '20', padding: 12, borderRadius: 12 }]}>
                            <Ionicons name={type.icon as any} size={24} color={type.color} />
                        </View>
                        <Text style={[styles.typeLabel, { color: colors.text }]}>
                            {type.label}
                        </Text>
                        <Text style={[styles.typeDescription, { color: colors.secondaryText }]}>
                            {type.description}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            {feedbackData.type && (
                <View style={styles.categoryContainer}>
                    <Text style={[styles.modernLabel, { color: colors.secondaryText, marginBottom: 12 }]}>
                        Category
                    </Text>
                    {CATEGORIES[feedbackData.type as keyof typeof CATEGORIES]?.map((category) => (
                        <TouchableOpacity
                            key={category}
                            style={[
                                styles.categoryButton,
                                {
                                    borderColor: feedbackData.category === category ? colors.primary : colors.border,
                                    backgroundColor: feedbackData.category === category ? colors.primary + '10' : colors.inputBackground,
                                }
                            ]}
                            onPress={() => updateField('category', category)}
                        >
                            <Ionicons
                                name={feedbackData.category === category ? 'checkmark-circle' : 'ellipse-outline'}
                                size={20}
                                color={feedbackData.category === category ? colors.primary : colors.secondaryText}
                            />
                            <Text style={[styles.categoryText, { color: colors.text }]}>
                                {category}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, {
                        backgroundColor: 'transparent',
                        borderColor: colors.border,
                        shadowColor: colors.border,
                        borderTopLeftRadius: 35,
                        borderBottomLeftRadius: 35,
                        borderTopRightRadius: 35,
                        borderBottomRightRadius: 35,
                    }]}
                    onPress={goBack}
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                        shadowColor: colors.primary,
                        borderTopLeftRadius: 35,
                        borderBottomLeftRadius: 35,
                        borderTopRightRadius: 35,
                        borderBottomRightRadius: 35,
                    }]}
                    onPress={nextStep}
                    disabled={!isTypeStepValid()}
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>Next</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, feedbackData, updateField, goBack, nextStep, isTypeStepValid, styles]);

    const renderDetailsStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    Tell us more
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Provide details about your feedback
                </Text>
            </View>

            <FormInput
                icon="create-outline"
                label="Title"
                value={feedbackData.title}
                onChangeText={(text) => {
                    updateField('title', text);
                    setErrorMessage('');
                }}
                placeholder="Brief summary of your feedback"
                testID="feedback-title-input"
                colors={colors}
                styles={styles}
            />

            <FormInput
                icon="document-text-outline"
                label="Description"
                value={feedbackData.description}
                onChangeText={(text) => {
                    updateField('description', text);
                    setErrorMessage('');
                }}
                placeholder="Please provide detailed information..."
                multiline={true}
                numberOfLines={6}
                testID="feedback-description-input"
                colors={colors}
                styles={styles}
            />

            <View style={styles.priorityContainer}>
                <Text style={[styles.modernLabel, { color: colors.secondaryText, marginBottom: 12 }]}>
                    Priority Level
                </Text>
                {PRIORITY_LEVELS.map((priority) => (
                    <TouchableOpacity
                        key={priority.id}
                        style={[
                            styles.priorityButton,
                            {
                                borderColor: feedbackData.priority === priority.id ? priority.color : colors.border,
                                backgroundColor: feedbackData.priority === priority.id ? priority.color + '10' : colors.inputBackground,
                            }
                        ]}
                        onPress={() => updateField('priority', priority.id)}
                    >
                        <Ionicons name={priority.icon as any} size={20} color={priority.color} />
                        <Text style={[styles.priorityLabel, { color: colors.text }]}>
                            {priority.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton, {
                        borderColor: colors.border,
                        shadowColor: colors.border,
                    }]}
                    onPress={prevStep}
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                        shadowColor: colors.primary,
                    }]}
                    onPress={nextStep}
                    disabled={!isDetailsStepValid()}
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>Next</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, feedbackData, updateField, setErrorMessage, prevStep, nextStep, isDetailsStepValid, styles]);

    const renderContactStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    Contact Information
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Help us get back to you
                </Text>
            </View>

            <FormInput
                icon="mail-outline"
                label="Email Address"
                value={feedbackData.contactEmail}
                onChangeText={(text) => {
                    updateField('contactEmail', text);
                    setErrorMessage('');
                }}
                placeholder={user?.email || "Enter your email address"}
                testID="feedback-email-input"
                colors={colors}
                styles={styles}
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
                >
                    {feedbackData.systemInfo && (
                        <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                    )}
                </TouchableOpacity>
                <Text style={[styles.checkboxText, { color: colors.text }]}>
                    Include system information to help us better understand your issue
                </Text>
            </View>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, styles.backButton, {
                        borderColor: colors.border,
                        shadowColor: colors.border,
                    }]}
                    onPress={prevStep}
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.navButton, styles.nextButton, {
                        backgroundColor: colors.primary,
                        borderColor: colors.primary,
                        shadowColor: colors.primary,
                    }]}
                    onPress={nextStep}
                    disabled={!isContactStepValid()}
                >
                    <Text style={[styles.navButtonText, { color: '#FFFFFF' }]}>Next</Text>
                    <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, feedbackData, user, updateField, setErrorMessage, prevStep, nextStep, isContactStepValid, styles]);

    const renderSummaryStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.modernHeader}>
                <Text style={[styles.stepTitle, { color: colors.text }]}>
                    Review & Submit
                </Text>
                <Text style={[styles.modernSubtitle, { color: colors.secondaryText }]}>
                    Please review your feedback before submitting
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
            >
                {feedbackState.status === 'submitting' ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                ) : (
                    <>
                        <Text style={styles.buttonText}>Submit Feedback</Text>
                        <Ionicons name="send" size={20} color="#FFFFFF" />
                    </>
                )}
            </TouchableOpacity>

            <View style={styles.navigationButtons}>
                <TouchableOpacity
                    style={[styles.navButton, {
                        backgroundColor: 'transparent',
                        borderColor: colors.border,
                        shadowColor: colors.border,
                        borderTopLeftRadius: 35,
                        borderBottomLeftRadius: 35,
                        borderTopRightRadius: 35,
                        borderBottomRightRadius: 35,
                    }]}
                    onPress={prevStep}
                >
                    <Ionicons name="arrow-back" size={16} color={colors.text} />
                    <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, feedbackData, user, feedbackState.status, handleSubmitFeedback, prevStep, styles]);

    const renderSuccessStep = useCallback(() => (
        <Animated.View style={[
            styles.stepContainer,
            { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }
        ]}>
            <View style={styles.successContainer}>
                <View style={[styles.successIcon, { backgroundColor: colors.success + '20', padding: 24, borderRadius: 50 }]}>
                    <Ionicons name="checkmark-circle" size={48} color={colors.success} />
                </View>
                <Text style={[styles.successTitle, { color: colors.text }]}>
                    Thank You!
                </Text>
                <Text style={[styles.successMessage, { color: colors.secondaryText }]}>
                    Your feedback has been submitted successfully. We'll review it and get back to you soon.
                </Text>
                <TouchableOpacity
                    style={[styles.button, { backgroundColor: colors.primary }]}
                    onPress={() => {
                        resetForm();
                        setCurrentStep(0);
                    }}
                >
                    <Text style={styles.buttonText}>Submit Another</Text>
                </TouchableOpacity>
            </View>
        </Animated.View>
    ), [fadeAnim, slideAnim, colors, resetForm, styles]);

    // Render current step
    const renderCurrentStep = useCallback(() => {
        if (feedbackState.status === 'success') {
            return renderSuccessStep();
        }

        switch (currentStep) {
            case 0: return renderTypeStep();
            case 1: return renderDetailsStep();
            case 2: return renderContactStep();
            case 3: return renderSummaryStep();
            default: return renderTypeStep();
        }
    }, [currentStep, feedbackState.status, renderTypeStep, renderDetailsStep, renderContactStep, renderSummaryStep, renderSuccessStep]);

    return (
        <KeyboardAvoidingView
            style={[styles.container, { backgroundColor: colors.background }]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
            <StatusBar
                barStyle={theme === 'dark' ? 'light-content' : 'dark-content'}
                backgroundColor={colors.background}
            />

            <ScrollView
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
            >
                {feedbackState.status !== 'success' && (
                    <ProgressIndicator currentStep={currentStep} totalSteps={4} colors={colors} styles={styles} />
                )}
                {renderCurrentStep()}
            </ScrollView>
        </KeyboardAvoidingView>
    );
};

export default FeedbackScreen; 