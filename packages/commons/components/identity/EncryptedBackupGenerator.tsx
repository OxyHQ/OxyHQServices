import React, { useState, useCallback, useEffect } from 'react';
import {
    View,
    StyleSheet,
    TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { ThemedText } from '@/components/themed-text';
import { Button, ImportantBanner } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useOxy } from '@oxyhq/services';
import { toast } from '@oxyhq/bloom';
import { KeyManager } from '@oxyhq/core';
import { useTranslation } from '@/lib/i18n';
import JSZip from 'jszip';

type IdentityStatus = 'checking' | 'present' | 'missing';

interface EncryptedBackupGeneratorProps {
    publicKey: string | null;
    onComplete?: () => void;
    onCancel?: () => void;
}

/**
 * Encrypted Backup Generator Component
 * Creates a password-protected backup file containing the private key
 * Similar to Bitcoin wallet.dat files
 */
export function EncryptedBackupGenerator({
    publicKey,
    onComplete,
    onCancel,
}: EncryptedBackupGeneratorProps) {
    const colors = useColors();
    const router = useRouter();
    const { oxyServices } = useOxy();
    const { t } = useTranslation();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [showPasswords, setShowPasswords] = useState(false);
    const [identityStatus, setIdentityStatus] = useState<IdentityStatus>('checking');

    // Pre-flight: confirm the device has an identity before showing inputs.
    // Without a private key, the backup is meaningless — there's nothing to encrypt.
    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const hasIdentity = await KeyManager.hasIdentity();
                if (!mounted) return;
                setIdentityStatus(hasIdentity ? 'present' : 'missing');
            } catch (error) {
                // `hasIdentity()` now THROWS when storage is locked/unreadable.
                // That is NOT "no identity" — assume `present` so we never show
                // the alarming "no identity on this device" state to a user who
                // actually has one (this screen is only reachable while signed
                // in). The real read (`getPrivateKey`, null-safe) surfaces a
                // retriable error if the keystore is still locked at backup time.
                if (!mounted) return;
                if (__DEV__) {
                    console.warn('[backup] identity preflight read failed (storage locked?)', error);
                }
                setIdentityStatus('present');
            }
        })();
        return () => { mounted = false; };
    }, []);

    // Separate validation for better performance and clarity
    const isPasswordValid = password.length >= 12;
    const doPasswordsMatch = password === confirmPassword && confirmPassword.length > 0;
    const canGenerate = isPasswordValid && doPasswordsMatch && !isGenerating;

    const generateBackupFile = useCallback(async () => {
        if (!publicKey) {
            toast.error(t('backup.errors.noPublicKey'));
            return;
        }

        if (!isPasswordValid) {
            toast.error(t('backup.errors.passwordMinLength'));
            return;
        }

        if (!doPasswordsMatch) {
            toast.error(t('backup.errors.passwordsMismatch'));
            return;
        }

        // Helper functions defined once to avoid re-creation
        const deriveKeyFromPassword = async (pwd: string, salt: Uint8Array, Crypto: typeof import('expo-crypto')): Promise<Uint8Array> => {
            // Use expo-crypto for key derivation
            // For production, use PBKDF2 with sufficient iterations (100,000+)
            // For now, using a simpler approach with multiple SHA-256 rounds
            // Simple key derivation: hash password + salt multiple times
            // In production, use PBKDF2 or Argon2
            const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('');
            let key = pwd + saltHex;

            // Perform 10,000 iterations for key stretching
            for (let i = 0; i < 10000; i++) {
                key = await Crypto.digestStringAsync(
                    Crypto.CryptoDigestAlgorithm.SHA256,
                    key
                );
            }

            // Convert hex string to bytes (take first 32 bytes for AES-256)
            const keyBytes = new Uint8Array(32);
            for (let i = 0; i < 64 && i < key.length; i += 2) {
                keyBytes[i / 2] = parseInt(key.substring(i, i + 2), 16);
            }
            return keyBytes;
        };

        const encryptPrivateKey = async (
            privateKey: string,
            password: string,
            salt: Uint8Array,
            iv: Uint8Array,
            Crypto: typeof import('expo-crypto')
        ): Promise<{ ciphertext: string; tag: string }> => {
            // Derive encryption key from password
            const keyBytes = await deriveKeyFromPassword(password, salt, Crypto);

            // Import raw key bytes into Web Crypto API for AES-256-GCM
            const cryptoKey = await crypto.subtle.importKey(
                'raw',
                keyBytes.buffer as ArrayBuffer,
                { name: 'AES-GCM' },
                false,
                ['encrypt']
            );

            const privateKeyBytes = new TextEncoder().encode(privateKey);

            // AES-GCM encrypt: produces ciphertext + 128-bit authentication tag
            // The tag is appended to the ciphertext by Web Crypto
            const encryptedBuffer = await crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer, tagLength: 128 },
                cryptoKey,
                privateKeyBytes
            );

            const encryptedBytes = new Uint8Array(encryptedBuffer);
            // Web Crypto appends the 16-byte auth tag at the end of the ciphertext
            const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - 16);
            const tag = encryptedBytes.slice(encryptedBytes.length - 16);

            return {
                ciphertext: Buffer.from(ciphertext).toString('base64'),
                tag: Buffer.from(tag).toString('base64'),
            };
        };

        try {
            setIsGenerating(true);

            // Load crypto module once
            const Crypto = await import('expo-crypto');

            // Get private key
            const privateKey = await KeyManager.getPrivateKey();
            if (!privateKey) {
                toast.error(t('backup.errors.noPrivateKey'));
                setIsGenerating(false);
                return;
            }

            // Generate random salt and IV (12 bytes is the recommended IV size for AES-GCM)
            const salt = Crypto.getRandomBytes(32);
            const iv = Crypto.getRandomBytes(12);

            // Encrypt private key
            const encrypted = await encryptPrivateKey(privateKey, password, salt, iv, Crypto);

            // Create timestamps once
            const now = new Date();
            const createdAt = now.toISOString();
            const dateStr = createdAt.split('T')[0];

            // Create backup file structure
            const backupData = {
                version: '2.0',
                type: 'oxy_identity_backup',
                algorithm: 'aes-256-gcm',
                encrypted: encrypted.ciphertext,
                tag: encrypted.tag,
                salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
                iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
                createdAt,
                publicKey,
            };

            // Create README.txt content
            const readmeContent = `${t('backup.readme.title')}
====================

${t('backup.readme.intro')}

${t('backup.readme.restoreTitle')}
1. ${t('backup.readme.restoreStep1')}
2. ${t('backup.readme.restoreStep2')}
3. ${t('backup.readme.restoreStep3')}

${t('backup.readme.importantTitle')}
- ${t('backup.readme.important1')}
- ${t('backup.readme.important2')}
- ${t('backup.readme.important3')}
- ${t('backup.readme.important4')}

${t('backup.readme.createdLabel')}: ${createdAt}
${t('backup.readme.publicKeyLabel')}: ${publicKey}`;

            // Create ZIP file
            const zip = new JSZip();
            zip.file('wallet.json', JSON.stringify(backupData, null, 2));
            zip.file('README.txt', readmeContent);

            const fileName = `oxy-identity-backup-${dateStr}.zip`;

            // Log backup creation to security activity (best-effort; never blocks the backup itself).
            if (oxyServices) {
                try {
                    await oxyServices.logBackupCreated();
                } catch (logError) {
                    if (__DEV__) {
                        console.warn('[backup] Failed to log security event:', logError);
                    }
                }
            }

            // Generate ZIP as Uint8Array (binary)
            const zipUint8Array = await zip.generateAsync({ type: 'uint8array' });

            // Get cache directory path (using legacy API just for the path)
            const cacheDir = FileSystemLegacy.cacheDirectory || '';
            const fileUri = `${cacheDir}${fileName}`;

            // Use new File API to write binary data
            const file = new File(fileUri);
            await file.write(zipUint8Array);

            // Share the file using expo-sharing
            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(fileUri, {
                    mimeType: 'application/zip',
                    dialogTitle: t('backup.shareDialogTitle'),
                    UTI: 'public.zip-archive', // Recommended for iOS
                });

                toast.success(t('backup.shareSuccess'));
                setPassword('');
                setConfirmPassword('');
                onComplete?.();
            } else {
                toast.error(t('backup.errors.sharingUnavailable'));
            }
        } catch (error) {
            if (__DEV__) {
                console.warn('[backup] Failed to generate backup:', error);
            }
            toast.error(error instanceof Error ? error.message : t('backup.errors.generateFailed'));
        } finally {
            setIsGenerating(false);
        }
    }, [password, publicKey, isPasswordValid, doPasswordsMatch, oxyServices, onComplete, t]);

    if (identityStatus === 'checking') {
        return (
            <View style={[styles.container, styles.centeredContainer, { backgroundColor: colors.background }]}>
                <ThemedText style={{ color: colors.textSecondary }}>{t('backup.checkingIdentity')}</ThemedText>
            </View>
        );
    }

    if (identityStatus === 'missing') {
        return (
            <View style={[styles.container, { backgroundColor: colors.background }]}>
                <View style={styles.header}>
                    <MaterialCommunityIcons name="key-alert-outline" size={32} color={colors.error} />
                    <ThemedText style={[styles.title, { color: colors.text }]}>
                        {t('backup.missingTitle')}
                    </ThemedText>
                    <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
                        {t('backup.missingSubtitle')}
                    </ThemedText>
                </View>

                <ImportantBanner iconSize={20}>
                    {t('backup.missingBanner')}
                </ImportantBanner>

                <View style={styles.buttonContainer}>
                    {onCancel && (
                        <Button variant="secondary" onPress={onCancel} style={styles.cancelButton}>
                            {t('backup.goBack')}
                        </Button>
                    )}
                    <Button
                        variant="primary"
                        onPress={() => router.replace('/(auth)/welcome')}
                        style={styles.generateButton}
                    >
                        {t('backup.setupIdentity')}
                    </Button>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <MaterialCommunityIcons name="shield-key" size={32} color={colors.tint} />
                <ThemedText style={[styles.title, { color: colors.text }]}>
                    {t('backup.title')}
                </ThemedText>
                <ThemedText style={[styles.subtitle, { color: colors.textSecondary }]}>
                    {t('backup.subtitle')}
                </ThemedText>
            </View>

            <ImportantBanner iconSize={20}>
                {t('backup.banner')}
            </ImportantBanner>

            <View style={styles.form}>
                <View style={styles.inputContainer}>
                    <ThemedText style={[styles.label, { color: colors.text }]}>{t('backup.password')}</ThemedText>
                    <View style={[styles.inputWrapper, {
                        borderColor: password.length > 0 && !isPasswordValid ? colors.error : colors.border,
                        backgroundColor: colors.card || 'rgba(0,0,0,0.02)',
                    }]}>
                        <TextInput
                            style={[styles.input, { color: colors.text }]}
                            value={password}
                            onChangeText={setPassword}
                            placeholder={t('backup.passwordPlaceholder')}
                            placeholderTextColor={colors.textSecondary}
                            secureTextEntry={!showPasswords}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!isGenerating}
                        />
                        <MaterialCommunityIcons
                            name={showPasswords ? 'eye-off' : 'eye'}
                            size={20}
                            color={colors.textSecondary}
                            onPress={() => setShowPasswords(!showPasswords)}
                            style={styles.eyeIcon}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        />
                    </View>
                    {password.length > 0 && !isPasswordValid && (
                        <ThemedText style={[styles.errorText, { color: colors.error }]}>
                            {t('backup.passwordTooShort')}
                        </ThemedText>
                    )}
                </View>

                <View style={styles.inputContainer}>
                    <ThemedText style={[styles.label, { color: colors.text }]}>{t('backup.confirmPassword')}</ThemedText>
                    <View style={[styles.inputWrapper, {
                        borderColor: confirmPassword.length > 0 && !doPasswordsMatch ? colors.error : colors.border,
                        backgroundColor: colors.card || 'rgba(0,0,0,0.02)',
                    }]}>
                        <TextInput
                            style={[styles.input, { color: colors.text }]}
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            placeholder={t('backup.confirmPasswordPlaceholder')}
                            placeholderTextColor={colors.textSecondary}
                            secureTextEntry={!showPasswords}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!isGenerating}
                        />
                    </View>
                    {confirmPassword.length > 0 && !doPasswordsMatch && (
                        <ThemedText style={[styles.errorText, { color: colors.error }]}>
                            {t('backup.passwordsDoNotMatch')}
                        </ThemedText>
                    )}
                </View>

                <View style={styles.buttonContainer}>
                    {onCancel && (
                        <Button
                            variant="secondary"
                            onPress={onCancel}
                            style={styles.cancelButton}
                            disabled={isGenerating}
                        >
                            {t('backup.cancel')}
                        </Button>
                    )}
                    <Button
                        variant="primary"
                        onPress={generateBackupFile}
                        loading={isGenerating}
                        disabled={!canGenerate}
                        style={styles.generateButton}
                    >
                        {isGenerating ? t('backup.generating') : t('backup.generate')}
                    </Button>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 20,
    },
    centeredContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    header: {
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: '600',
        marginTop: 12,
        marginBottom: 8,
    },
    subtitle: {
        fontSize: 14,
        textAlign: 'center',
        lineHeight: 20,
    },
    form: {
        flex: 1,
    },
    inputContainer: {
        marginBottom: 20,
    },
    label: {
        fontSize: 14,
        fontWeight: '500',
        marginBottom: 8,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
    },
    input: {
        flex: 1,
        fontSize: 16,
        paddingVertical: 12,
    },
    eyeIcon: {
        padding: 8,
    },
    errorText: {
        fontSize: 12,
        marginTop: 4,
        marginLeft: 4,
    },
    buttonContainer: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 'auto',
        paddingTop: 24,
    },
    cancelButton: {
        flex: 1,
    },
    generateButton: {
        flex: 1,
    },
});

