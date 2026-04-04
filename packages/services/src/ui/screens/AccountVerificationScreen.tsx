import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    Alert,
} from 'react-native';
import type { BaseScreenProps } from '../types/navigation';
import { toast } from '../../lib/sonner';
import { Header, Section } from '../components';
import { useI18n } from '../hooks/useI18n';
import { useTheme } from '@oxyhq/bloom/theme';
import { useOxy } from '../context/OxyContext';

const AccountVerificationScreen: React.FC<BaseScreenProps> = ({
    onClose,
    theme,
    goBack,
}) => {
    // Use useOxy() hook for OxyContext values
    const { oxyServices, user } = useOxy();
    const { t } = useI18n();
    const [reason, setReason] = useState('');
    const [evidence, setEvidence] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const bloomTheme = useTheme();

    const handleSubmit = useCallback(async () => {
        if (!reason.trim()) {
            toast.error(t('accountVerification.reasonRequired') || 'Please provide a reason for verification');
            return;
        }

        if (!oxyServices) {
            toast.error(t('accountVerification.error') || 'Service not available');
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await oxyServices.requestAccountVerification(
                reason.trim(),
                evidence.trim() || undefined
            );

            Alert.alert(
                t('accountVerification.successTitle') || 'Request Submitted',
                t('accountVerification.successMessage') || `Your verification request has been submitted. Request ID: ${result.requestId}`,
                [
                    {
                        text: t('accountVerification.ok') || 'OK',
                        onPress: () => {
                            setReason('');
                            setEvidence('');
                            goBack?.();
                        },
                    },
                ]
            );
        } catch (error: unknown) {
            if (__DEV__) {
                console.error('Failed to submit verification request:', error);
            }
            toast.error(
                (error instanceof Error ? error.message : null) || t('accountVerification.submitError') || 'Failed to submit verification request'
            );
        } finally {
            setIsSubmitting(false);
        }
    }, [reason, evidence, oxyServices, t, goBack]);

    return (
        <View style={[styles.container, { backgroundColor: bloomTheme.colors.background }]}>
            <Header
                title={t('accountVerification.title') || 'Account Verification'}

                onBack={goBack || onClose}
                variant="minimal"
                elevation="subtle"
            />

            <ScrollView style={styles.content}>
                <Section  isFirst={true}>
                    <Text style={styles.description} className="text-muted-foreground">
                        {t('accountVerification.description') || 'Request a verified badge for your account. Verified accounts help establish authenticity and credibility.'}
                    </Text>
                </Section>

                <Section title={t('accountVerification.sections.request') || 'VERIFICATION REQUEST'} >
                    <View style={styles.inputGroup}>
                        <Text style={styles.label} className="text-foreground">
                            {t('accountVerification.reasonLabel') || 'Reason for Verification *'}
                        </Text>
                        <TextInput
                            style={[
                                styles.textInput,
                                styles.textArea,
                            ]}
                            className="bg-secondary text-foreground border-border"
                            value={reason}
                            onChangeText={setReason}
                            placeholder={t('accountVerification.reasonPlaceholder') || 'Explain why you need a verified badge (e.g., public figure, brand, organization)'}
                            placeholderTextColor={bloomTheme.colors.textSecondary}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                            editable={!isSubmitting}
                        />
                    </View>

                    <View style={styles.inputGroup}>
                        <Text style={styles.label} className="text-foreground">
                            {t('accountVerification.evidenceLabel') || 'Evidence (Optional)'}
                        </Text>
                        <TextInput
                            style={[
                                styles.textInput,
                                styles.textArea,
                            ]}
                            className="bg-secondary text-foreground border-border"
                            value={evidence}
                            onChangeText={setEvidence}
                            placeholder={t('accountVerification.evidencePlaceholder') || 'Provide any supporting documentation or links (e.g., official website, social media profiles)'}
                            placeholderTextColor={bloomTheme.colors.textSecondary}
                            multiline
                            numberOfLines={4}
                            textAlignVertical="top"
                            editable={!isSubmitting}
                        />
                    </View>
                </Section>

                <Section >
                    <TouchableOpacity
                        style={styles.submitButton}
                        className={isSubmitting ? 'bg-muted-foreground' : 'bg-primary'}
                        onPress={handleSubmit}
                        disabled={isSubmitting || !reason.trim()}
                    >
                        {isSubmitting ? (
                            <ActivityIndicator color="#FFFFFF" />
                        ) : (
                            <Text style={styles.submitButtonText}>
                                {t('accountVerification.submit') || 'Submit Request'}
                            </Text>
                        )}
                    </TouchableOpacity>
                </Section>

                <Section >
                    <Text style={styles.note} className="text-muted-foreground">
                        {t('accountVerification.note') || 'Note: Verification requests are reviewed manually and may take several days. We will notify you once your request has been reviewed.'}
                    </Text>
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
    description: {
        fontSize: 16,
        lineHeight: 24,
        marginBottom: 8,
    },
    inputGroup: {
        marginBottom: 24,
    },
    label: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 8,
    },
    textInput: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        minHeight: 44,
    },
    textArea: {
        minHeight: 100,
        paddingTop: 12,
    },
    submitButton: {
        borderRadius: 8,
        padding: 16,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 50,
    },
    submitButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
    },
    note: {
        fontSize: 14,
        lineHeight: 20,
        fontStyle: 'italic',
    },
});

export default React.memo(AccountVerificationScreen);

