import React, { useState, useCallback } from 'react';
import {
    View,
    StyleSheet,
    TextInput,
} from 'react-native';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { ThemedText } from '@/components/themed-text';
import { Button, ImportantBanner, useAlert } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { File } from 'expo-file-system';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { KeyManager, useOxy } from '@oxyhq/services';
import JSZip from 'jszip';

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
    const colorScheme = useColorScheme() ?? 'light';
    const colors = Colors[colorScheme];
    const { oxyServices } = useOxy();
    const alert = useAlert();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [showPasswords, setShowPasswords] = useState(false);

    // Separate validation for better performance and clarity
    const isPasswordValid = password.length >= 12;
    const doPasswordsMatch = password === confirmPassword && confirmPassword.length > 0;
    const canGenerate = isPasswordValid && doPasswordsMatch && !isGenerating;

    const generateBackupFile = useCallback(async () => {
        if (!publicKey) {
            alert('Error', 'Public key not available');
            return;
        }

        if (!isPasswordValid) {
            alert('Invalid Password', 'Password must be at least 12 characters long');
            return;
        }

        if (!doPasswordsMatch) {
            alert('Invalid Password', 'Passwords do not match');
            return;
        }

        // Helper functions defined once to avoid re-creation
        const deriveKeyFromPassword = async (pwd: string, salt: Uint8Array, Crypto: any): Promise<Uint8Array> => {
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
            Crypto: any
        ): Promise<string> => {
            // Derive encryption key from password
            const key = await deriveKeyFromPassword(password, salt, Crypto);

            // Simple XOR encryption (for production, use AES-GCM)
            // TODO: Implement proper AES-256-GCM encryption
            // For now, using XOR as a placeholder - NOT SECURE FOR PRODUCTION
            const privateKeyBytes = new TextEncoder().encode(privateKey);
            const encrypted = new Uint8Array(privateKeyBytes.length);
            for (let i = 0; i < privateKeyBytes.length; i++) {
                encrypted[i] = privateKeyBytes[i] ^ key[i % key.length] ^ iv[i % iv.length];
            }

            // Convert to base64 using Buffer (works in React Native)
            return Buffer.from(encrypted).toString('base64');
        };

        try {
            setIsGenerating(true);

            // Load crypto module once
            const Crypto = await import('expo-crypto');

            // Get private key
            const privateKey = await KeyManager.getPrivateKey();
            if (!privateKey) {
                alert('Error', 'No private key found on this device');
                setIsGenerating(false);
                return;
            }

            // Generate random salt and IV
            const salt = Crypto.getRandomBytes(32);
            const iv = Crypto.getRandomBytes(16);

            // Encrypt private key
            const encrypted = await encryptPrivateKey(privateKey, password, salt, iv, Crypto);

            // Create timestamps once
            const now = new Date();
            const createdAt = now.toISOString();
            const dateStr = createdAt.split('T')[0];

            // Create backup file structure
            const backupData = {
                version: '1.0',
                type: 'oxy_identity_backup',
                algorithm: 'xor-sha256', // TODO: Change to 'aes-256-gcm' when proper encryption is implemented
                encrypted,
                salt: Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join(''),
                iv: Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(''),
                createdAt,
                publicKey,
            };

            // Create README.txt content
            const readmeContent = `Oxy Identity Backup
====================

This backup file contains your encrypted identity.

To restore:
1. Extract this ZIP file
2. Use the Oxy Accounts app to import the wallet.json file
3. Enter your backup password when prompted

IMPORTANT:
- Store this file in a secure location (safe, encrypted drive, etc.)
- Never share your password or backup file
- Keep multiple copies in different secure locations
- If this backup is compromised, create a new identity immediately

Created: ${createdAt}
Public Key: ${publicKey}`;

            // Create ZIP file
            const zip = new JSZip();
            zip.file('wallet.json', JSON.stringify(backupData, null, 2));
            zip.file('README.txt', readmeContent);

            const fileName = `oxy-identity-backup-${dateStr}.zip`;

            // Log backup creation to security activity
            if (oxyServices && typeof (oxyServices as any).logBackupCreated === 'function') {
                try {
                    await (oxyServices as any).logBackupCreated();
                } catch (logError) {
                    // Log error but don't fail the backup
                    console.error('Failed to log security event:', logError);
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
                    dialogTitle: 'Share Oxy Identity Backup',
                    UTI: 'public.zip-archive', // Recommended for iOS
                });

                alert(
                    'Success',
                    'Backup file ready. Save it to a secure location like your password manager, encrypted drive, or offline storage.',
                    [
                        {
                            text: 'OK',
                            onPress: () => {
                                setPassword('');
                                setConfirmPassword('');
                                onComplete?.();
                            },
                        },
                    ]
                );
            } else {
                alert('Error', 'Sharing is not available on this platform');
            }
        } catch (error: any) {
            console.error('Failed to generate backup:', error);
            alert('Error', error?.message || 'Failed to generate backup file');
        } finally {
            setIsGenerating(false);
        }
    }, [password, publicKey, isPasswordValid, doPasswordsMatch, oxyServices, onComplete]);

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={styles.header}>
                <MaterialCommunityIcons name="shield-key" size={32} color={colors.tint} />
                <ThemedText style={[styles.title, { color: colors.text }]}>
                    Create Encrypted Backup
                </ThemedText>
                <ThemedText style={[styles.subtitle, { color: colors.secondaryText }]}>
                    Generate a password-protected backup file that you can store securely offline.
                </ThemedText>
            </View>

            <ImportantBanner iconSize={20}>
                Store this file in a secure location (safe, encrypted drive, etc.). Never share your password or backup file.
            </ImportantBanner>

            <View style={styles.form}>
                <View style={styles.inputContainer}>
                    <ThemedText style={[styles.label, { color: colors.text }]}>Password</ThemedText>
                    <View style={[styles.inputWrapper, {
                        borderColor: password.length > 0 && !isPasswordValid ? '#FF3B30' : colors.border,
                        backgroundColor: colors.card || 'rgba(0,0,0,0.02)',
                    }]}>
                        <TextInput
                            style={[styles.input, { color: colors.text }]}
                            value={password}
                            onChangeText={setPassword}
                            placeholder="Enter password (min 12 characters)"
                            placeholderTextColor={colors.secondaryText}
                            secureTextEntry={!showPasswords}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!isGenerating}
                        />
                        <MaterialCommunityIcons
                            name={showPasswords ? 'eye-off' : 'eye'}
                            size={20}
                            color={colors.secondaryText}
                            onPress={() => setShowPasswords(!showPasswords)}
                            style={styles.eyeIcon}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        />
                    </View>
                    {password.length > 0 && !isPasswordValid && (
                        <ThemedText style={[styles.errorText, { color: '#FF3B30' }]}>
                            Password must be at least 12 characters
                        </ThemedText>
                    )}
                </View>

                <View style={styles.inputContainer}>
                    <ThemedText style={[styles.label, { color: colors.text }]}>Confirm Password</ThemedText>
                    <View style={[styles.inputWrapper, {
                        borderColor: confirmPassword.length > 0 && !doPasswordsMatch ? '#FF3B30' : colors.border,
                        backgroundColor: colors.card || 'rgba(0,0,0,0.02)',
                    }]}>
                        <TextInput
                            style={[styles.input, { color: colors.text }]}
                            value={confirmPassword}
                            onChangeText={setConfirmPassword}
                            placeholder="Confirm password"
                            placeholderTextColor={colors.secondaryText}
                            secureTextEntry={!showPasswords}
                            autoCapitalize="none"
                            autoCorrect={false}
                            editable={!isGenerating}
                        />
                    </View>
                    {confirmPassword.length > 0 && !doPasswordsMatch && (
                        <ThemedText style={[styles.errorText, { color: '#FF3B30' }]}>
                            Passwords do not match
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
                            Cancel
                        </Button>
                    )}
                    <Button
                        variant="primary"
                        onPress={generateBackupFile}
                        loading={isGenerating}
                        disabled={!canGenerate}
                        style={styles.generateButton}
                    >
                        {isGenerating ? 'Generating...' : 'Generate Backup'}
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

