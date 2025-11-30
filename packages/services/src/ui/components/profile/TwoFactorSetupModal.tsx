import React, { useState, useEffect } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Platform,
    ScrollView,
    ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useThemeStyles } from '../../hooks/useThemeStyles';
import { useColorScheme } from '../../hooks/use-color-scheme';
import { useI18n } from '../../hooks/useI18n';
import { fontFamilies } from '../../styles/fonts';
import { useOxy } from '../../context/OxyContext';
import { useAuthStore } from '../../stores/authStore';
import { toast } from '../../../lib/sonner';

interface TwoFactorSetupModalProps {
    visible: boolean;
    onClose: () => void;
    isEnabled: boolean;
    theme?: 'light' | 'dark';
    onSave?: () => void;
}

export const TwoFactorSetupModal: React.FC<TwoFactorSetupModalProps> = ({
    visible,
    onClose,
    isEnabled,
    theme = 'light',
    onSave,
}) => {
    const { t } = useI18n();
    const colorScheme = useColorScheme();
    const themeStyles = useThemeStyles(theme || 'light', colorScheme);
    const colors = themeStyles.colors;
    const { oxyServices, activeSessionId } = useOxy();
    const updateUser = useAuthStore((state) => state.updateUser);

    const [totpSetupUrl, setTotpSetupUrl] = useState<string | null>(null);
    const [totpCode, setTotpCode] = useState('');
    const [isBusy, setIsBusy] = useState(false);
    const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
    const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
    const [recoveryKey, setRecoveryKey] = useState<string | null>(null);

    useEffect(() => {
        if (visible && !isEnabled) {
            setTotpSetupUrl(null);
            setTotpCode('');
            setShowRecoveryCodes(false);
            setRecoveryCodes(null);
            setRecoveryKey(null);
        }
    }, [visible, isEnabled]);

    const handleGenerateQR = async () => {
        if (!activeSessionId || !oxyServices) {
            toast.error(t('editProfile.toasts.noActiveSession') || 'No active session');
            return;
        }

        setIsBusy(true);
        try {
            const { otpauthUrl } = await oxyServices.startTotpEnrollment(activeSessionId);
            setTotpSetupUrl(otpauthUrl);
        } catch (e: any) {
            toast.error(e?.message || (t('editProfile.toasts.totpStartFailed') || 'Failed to start TOTP enrollment'));
        } finally {
            setIsBusy(false);
        }
    };

    const handleVerify = async () => {
        if (!activeSessionId || !oxyServices) {
            toast.error(t('editProfile.toasts.noActiveSession') || 'No active session');
            return;
        }

        if (totpCode.length !== 6) {
            toast.error(t('editProfile.toasts.invalidCode') || 'Please enter a 6-digit code');
            return;
        }

        setIsBusy(true);
        try {
            const result = await oxyServices.verifyTotpEnrollment(activeSessionId, totpCode);
            await updateUser({ privacySettings: { twoFactorEnabled: true } }, oxyServices);
            
            if (result?.backupCodes || result?.recoveryKey) {
                setRecoveryCodes(result.backupCodes || null);
                setRecoveryKey(result.recoveryKey || null);
                setShowRecoveryCodes(true);
            } else {
                toast.success(t('editProfile.toasts.twoFactorEnabled') || 'Two‑Factor Authentication enabled');
                onSave?.();
                onClose();
            }
        } catch (e: any) {
            toast.error(e?.message || (t('editProfile.toasts.invalidCode') || 'Invalid code'));
        } finally {
            setIsBusy(false);
        }
    };

    const handleDisable = async () => {
        if (!activeSessionId || !oxyServices) {
            toast.error(t('editProfile.toasts.noActiveSession') || 'No active session');
            return;
        }

        if (totpCode.length !== 6) {
            toast.error(t('editProfile.toasts.invalidCode') || 'Please enter a 6-digit code');
            return;
        }

        setIsBusy(true);
        try {
            // Verify code before disabling
            await oxyServices.verifyTotpEnrollment(activeSessionId, totpCode);
            await updateUser({ privacySettings: { twoFactorEnabled: false } }, oxyServices);
            toast.success(t('editProfile.toasts.twoFactorDisabled') || 'Two‑Factor Authentication disabled');
            onSave?.();
            onClose();
        } catch (e: any) {
            toast.error(e?.message || (t('editProfile.toasts.invalidCode') || 'Invalid code'));
        } finally {
            setIsBusy(false);
        }
    };

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={true}
            onRequestClose={onClose}
        >
            <View style={styles.modalOverlay}>
                <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                            <Ionicons name="close" size={24} color={colors.text} />
                        </TouchableOpacity>
                        <Text style={[styles.modalTitle, { color: colors.text }]}>
                            {t('editProfile.items.twoFactor.title') || 'Two‑Factor Authentication'}
                        </Text>
                        <View style={{ width: 40 }} />
                    </View>

                    <ScrollView style={styles.modalBody}>
                        {showRecoveryCodes ? (
                            <View style={styles.recoverySection}>
                                <Text style={[styles.sectionTitle, { color: colors.text }]}>
                                    {t('editProfile.items.twoFactor.saveCodes') || 'Save These Codes'}
                                </Text>
                                <Text style={[styles.description, { color: colors.secondaryText }]}>
                                    {t('editProfile.items.twoFactor.recoveryDescription') || 'Backup codes and your Recovery Key are shown only once. Store them securely.'}
                                </Text>
                                
                                {recoveryCodes && recoveryCodes.length > 0 && (
                                    <View style={styles.recoveryCodesContainer}>
                                        <Text style={[styles.recoveryLabel, { color: colors.text }]}>Backup Codes</Text>
                                        <View style={[styles.codesBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                            {recoveryCodes.map((code, idx) => (
                                                <Text key={idx} style={[styles.codeText, { color: colors.text }]}>
                                                    {code}
                                                </Text>
                                            ))}
                                        </View>
                                    </View>
                                )}

                                {recoveryKey && (
                                    <View style={styles.recoveryCodesContainer}>
                                        <Text style={[styles.recoveryLabel, { color: colors.text }]}>Recovery Key</Text>
                                        <View style={[styles.codesBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                                            <Text style={[styles.codeText, { color: colors.text }]}>
                                                {recoveryKey}
                                            </Text>
                                        </View>
                                    </View>
                                )}

                                <TouchableOpacity
                                    style={[styles.primaryButton, { backgroundColor: colors.tint }]}
                                    onPress={() => {
                                        setShowRecoveryCodes(false);
                                        onSave?.();
                                        onClose();
                                    }}
                                >
                                    <Text style={styles.primaryButtonText}>
                                        {t('editProfile.items.twoFactor.saved') || 'I saved them'}
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        ) : isEnabled ? (
                            <View style={styles.disableSection}>
                                <Text style={[styles.description, { color: colors.secondaryText }]}>
                                    {t('editProfile.items.twoFactor.disableDescription') || 'Two‑Factor Authentication is currently enabled. To disable, enter a code from your authenticator app.'}
                                </Text>
                                <View style={styles.inputGroup}>
                                    <Text style={[styles.label, { color: colors.text }]}>
                                        {t('editProfile.items.twoFactor.enterCode') || 'Enter 6‑digit code'}
                                    </Text>
                                    <TextInput
                                        style={[
                                            styles.input,
                                            {
                                                backgroundColor: colors.card,
                                                color: colors.text,
                                                borderColor: colors.border,
                                            },
                                        ]}
                                        value={totpCode}
                                        onChangeText={setTotpCode}
                                        placeholder="123456"
                                        placeholderTextColor={colors.secondaryText}
                                        keyboardType="number-pad"
                                        maxLength={6}
                                        selectionColor={colors.tint}
                                    />
                                </View>
                                <TouchableOpacity
                                    style={[styles.primaryButton, { backgroundColor: '#FF3B30' }]}
                                    disabled={isBusy || totpCode.length !== 6}
                                    onPress={handleDisable}
                                >
                                    {isBusy ? (
                                        <ActivityIndicator size="small" color="#fff" />
                                    ) : (
                                        <Text style={styles.primaryButtonText}>
                                            {t('editProfile.items.twoFactor.disable') || 'Disable'}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        ) : (
                            <View style={styles.enableSection}>
                                <Text style={[styles.description, { color: colors.secondaryText }]}>
                                    {t('editProfile.items.twoFactor.description') || 'Protect your account with a 6‑digit code from an authenticator app. Scan the QR code then enter the code to enable.'}
                                </Text>
                                
                                {!totpSetupUrl ? (
                                    <TouchableOpacity
                                        style={[styles.primaryButton, { backgroundColor: colors.tint }]}
                                        disabled={isBusy}
                                        onPress={handleGenerateQR}
                                    >
                                        {isBusy ? (
                                            <ActivityIndicator size="small" color="#fff" />
                                        ) : (
                                            <>
                                                <Ionicons name="shield-checkmark" size={18} color="#fff" />
                                                <Text style={styles.primaryButtonText}>
                                                    {t('editProfile.items.twoFactor.generateQR') || 'Generate QR Code'}
                                                </Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                ) : (
                                    <>
                                        <View style={[styles.qrContainer, { backgroundColor: '#fff' }]}>
                                            <QRCode value={totpSetupUrl} size={180} />
                                        </View>
                                        <View style={styles.inputGroup}>
                                            <Text style={[styles.label, { color: colors.text }]}>
                                                {t('editProfile.items.twoFactor.enterCode') || 'Enter 6‑digit code'}
                                            </Text>
                                            <TextInput
                                                style={[
                                                    styles.input,
                                                    {
                                                        backgroundColor: colors.card,
                                                        color: colors.text,
                                                        borderColor: colors.border,
                                                    },
                                                ]}
                                                value={totpCode}
                                                onChangeText={setTotpCode}
                                                placeholder="123456"
                                                placeholderTextColor={colors.secondaryText}
                                                keyboardType="number-pad"
                                                maxLength={6}
                                                selectionColor={colors.tint}
                                            />
                                        </View>
                                        <TouchableOpacity
                                            style={[styles.primaryButton, { backgroundColor: colors.tint }]}
                                            disabled={isBusy || totpCode.length !== 6}
                                            onPress={handleVerify}
                                        >
                                            {isBusy ? (
                                                <ActivityIndicator size="small" color="#fff" />
                                            ) : (
                                                <>
                                                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                                                    <Text style={styles.primaryButtonText}>
                                                        {t('editProfile.items.twoFactor.verify') || 'Verify & Enable'}
                                                    </Text>
                                                </>
                                            )}
                                        </TouchableOpacity>
                                    </>
                                )}
                            </View>
                        )}
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: Platform.OS === 'ios' ? 20 : 16,
        maxHeight: '80%',
    },
    modalHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingBottom: 16,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: '#E5E5EA',
    },
    closeButton: {
        width: 40,
        height: 40,
        alignItems: 'center',
        justifyContent: 'center',
    },
    modalTitle: {
        fontSize: 18,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
        flex: 1,
        textAlign: 'center',
    },
    modalBody: {
        padding: 16,
    },
    enableSection: {
        gap: 24,
        alignItems: 'center',
    },
    disableSection: {
        gap: 24,
    },
    recoverySection: {
        gap: 24,
    },
    sectionTitle: {
        fontSize: 20,
        fontWeight: '700',
        fontFamily: fontFamilies.phuduBold,
    },
    description: {
        fontSize: 14,
        lineHeight: 20,
    },
    qrContainer: {
        padding: 16,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    inputGroup: {
        width: '100%',
        gap: 8,
    },
    label: {
        fontSize: 14,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    input: {
        borderWidth: StyleSheet.hairlineWidth,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
        minHeight: 52,
        textAlign: 'center',
    },
    primaryButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 12,
        width: '100%',
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    recoveryCodesContainer: {
        gap: 8,
    },
    recoveryLabel: {
        fontSize: 16,
        fontWeight: '600',
        fontFamily: fontFamilies.phuduSemiBold,
    },
    codesBox: {
        padding: 16,
        borderRadius: 12,
        borderWidth: StyleSheet.hairlineWidth,
        gap: 8,
    },
    codeText: {
        fontSize: 14,
        fontFamily: Platform.OS === 'web' ? 'monospace' as any : 'monospace',
    },
});

