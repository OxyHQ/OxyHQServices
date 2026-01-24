import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
    Modal,
    Platform,
} from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, Easing } from 'react-native-reanimated';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useOxy } from '@oxyhq/services';

interface UsernameRequiredModalProps {
    visible: boolean;
    onComplete: () => void;
    onCancel?: () => void;
}

// Generate a random suggested username
const generateSuggestedUsername = (): string => {
    return Math.floor(1000 + Math.random() * 9000).toString();
};

export function UsernameRequiredModal({ visible, onComplete, onCancel }: UsernameRequiredModalProps) {
    const colorScheme = useColorScheme() ?? 'light';
    const insets = useSafeAreaInsets();
    const { oxyServices } = useOxy();

    const backgroundColor = useMemo(() =>
        colorScheme === 'dark' ? '#000000' : '#FFFFFF',
        [colorScheme]
    );
    const textColor = useMemo(() =>
        colorScheme === 'dark' ? '#FFFFFF' : '#000000',
        [colorScheme]
    );

    const [username, setUsername] = useState<string>('');
    const [usernameError, setUsernameError] = useState<string | null>(null);
    const [isCheckingUsername, setIsCheckingUsername] = useState(false);
    const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const hasInitializedUsername = useRef(false);

    const opacity = useSharedValue(0);
    const scale = useSharedValue(0.95);

    useEffect(() => {
        if (visible) {
            opacity.value = withTiming(1, {
                duration: 250,
                easing: Easing.out(Easing.ease),
            });
            scale.value = withTiming(1, {
                duration: 250,
                easing: Easing.out(Easing.ease),
            });
            // Generate suggested username only once when modal first opens
            if (!hasInitializedUsername.current) {
                setUsername(generateSuggestedUsername());
                hasInitializedUsername.current = true;
            }
        } else {
            opacity.value = withTiming(0, {
                duration: 200,
                easing: Easing.in(Easing.ease),
            });
            scale.value = withTiming(0.95, {
                duration: 200,
                easing: Easing.in(Easing.ease),
            });
            // Reset initialization flag when modal closes
            hasInitializedUsername.current = false;
            setUsername('');
        }
    }, [visible, opacity, scale]);

    // Username validation
    useEffect(() => {
        if (!username || username.length < 4) {
            setUsernameAvailable(null);
            setUsernameError(null);
            return;
        }

        // Validate format
        if (!/^[a-z0-9]+$/i.test(username)) {
            setUsernameError('You can use a-z, 0-9. Minimum length is 4 characters.');
            setUsernameAvailable(false);
            return;
        }

        setUsernameError(null);

        // Debounce API check
        const timer = setTimeout(async () => {
            if (!oxyServices) return;

            setIsCheckingUsername(true);
            try {
                const result = await oxyServices.checkUsernameAvailability(username);
                setUsernameAvailable(result.available);
                if (!result.available) {
                    setUsernameError(result.message || 'Username is already taken');
                }
            } catch (err: any) {
                const errorMsg = err?.message || '';
                // Handle timeout and network errors gracefully
                if (
                    errorMsg.includes('network') ||
                    errorMsg.includes('offline') ||
                    errorMsg.includes('timeout') ||
                    errorMsg.includes('cancelled') ||
                    errorMsg.includes('ECONNABORTED')
                ) {
                    // Allow proceeding if offline/network issue
                    setUsernameAvailable(true);
                } else {
                    setUsernameAvailable(false);
                    setUsernameError(errorMsg || 'Failed to check username availability');
                }
            } finally {
                setIsCheckingUsername(false);
            }
        }, 500);

        return () => clearTimeout(timer);
    }, [username, oxyServices]);

    const handleSave = useCallback(async () => {
        if (!username || username.length < 4 || !/^[a-z0-9]+$/i.test(username)) {
            setUsernameError('Please enter a valid username (4+ characters, a-z and 0-9 only)');
            return;
        }

        if (usernameAvailable === false || isCheckingUsername) {
            return;
        }

        setIsSaving(true);
        try {
            if (oxyServices) {
                await oxyServices.updateProfile({ username });
            }
            onComplete();
        } catch (err: any) {
            setUsernameError(err?.message || 'Failed to save username');
        } finally {
            setIsSaving(false);
        }
    }, [username, usernameAvailable, isCheckingUsername, oxyServices, onComplete]);

    const overlayStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    const containerStyle = useAnimatedStyle(() => ({
        transform: [{ scale: scale.value }],
    }));

    const isUsernameValid = username.length >= 4 && /^[a-z0-9]+$/i.test(username);
    const canContinue = isUsernameValid && (usernameAvailable === true || usernameAvailable === null) && !isCheckingUsername && !isSaving;

    return (
        <Modal
            transparent
            visible={visible}
            animationType="none"
            onRequestClose={onCancel}
        >
            <Animated.View style={[styles.overlay, overlayStyle]}>
                <TouchableOpacity
                    style={StyleSheet.absoluteFill}
                    activeOpacity={1}
                    onPress={onCancel}
                />
                <Animated.View
                    style={[
                        styles.modalContainer,
                        {
                            marginTop: insets.top,
                            marginBottom: insets.bottom,
                            marginLeft: insets.left,
                            marginRight: insets.right,
                        },
                        containerStyle,
                    ]}
                    pointerEvents="box-none"
                >
                    <KeyboardAvoidingView
                        behavior="padding"
                        keyboardVerticalOffset={0}
                    >
                        <BlurView
                            intensity={100}
                            tint={colorScheme === 'dark' ? 'dark' : 'light'}
                            experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
                            style={[
                                styles.modalContent,
                                {
                                    backgroundColor: colorScheme === 'dark'
                                        ? 'rgba(0, 0, 0, 0.95)'
                                        : 'rgba(255, 255, 255, 0.95)',
                                },
                            ]}
                        >
                            <Text style={[styles.title, { color: textColor }]}>Username Required</Text>
                            <Text style={[styles.subtitle, { color: textColor, opacity: 0.6 }]}>
                                You need to set a username before you can sync your identity
                            </Text>

                            <View style={styles.inputWrapper}>
                                <TextInput
                                    style={[styles.usernameInput, {
                                        color: textColor,
                                        backgroundColor: colorScheme === 'dark' ? '#1C1C1E' : '#F5F5F5',
                                        borderColor: usernameError ? '#DC3545' : (colorScheme === 'dark' ? '#2C2C2E' : '#E0E0E0')
                                    }]}
                                    placeholder="Username"
                                    placeholderTextColor={colorScheme === 'dark' ? '#8E8E93' : '#8E8E93'}
                                    value={username}
                                    onChangeText={(text) => {
                                        setUsername(text.toLowerCase().replace(/[^a-z0-9]/g, ''));
                                        setUsernameError(null);
                                    }}
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                    autoFocus
                                />
                            </View>

                            <Text style={[styles.inputHint, { color: textColor, opacity: 0.6 }]}>
                                You can use a-z, 0-9. Minimum length is 4 characters.
                            </Text>

                            {isCheckingUsername && (
                                <Text style={[styles.checkingText, { color: textColor, opacity: 0.6 }]}>
                                    Checking availability...
                                </Text>
                            )}

                            {usernameAvailable === true && !isCheckingUsername && (
                                <Text style={[styles.availableText, { color: '#28A745' }]}>
                                    ✓ Username is available
                                </Text>
                            )}

                            {usernameError && (
                                <Text style={styles.errorText}>{usernameError}</Text>
                            )}

                            <TouchableOpacity
                                style={[
                                    styles.primaryButton,
                                    {
                                        backgroundColor: canContinue ? textColor : (colorScheme === 'dark' ? '#2C2C2E' : '#CCCCCC'),
                                        opacity: canContinue ? 1 : 0.6,
                                    }
                                ]}
                                onPress={handleSave}
                                disabled={!canContinue}
                            >
                                <Text style={[
                                    styles.primaryButtonText,
                                    { color: canContinue ? backgroundColor : (colorScheme === 'dark' ? '#8E8E93' : '#999999') }
                                ]}>
                                    {isSaving ? 'Saving...' : 'Save Username'}
                                </Text>
                            </TouchableOpacity>

                            {onCancel && (
                                <TouchableOpacity
                                    style={styles.cancelButton}
                                    onPress={onCancel}
                                >
                                    <Text style={[styles.cancelText, { color: textColor, opacity: 0.6 }]}>
                                        Cancel
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </BlurView>
                    </KeyboardAvoidingView>
                </Animated.View>
            </Animated.View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContainer: {
        width: '90%',
        maxWidth: 400,
    },
    modalContent: {
        borderRadius: 16,
        padding: 24,
        overflow: 'hidden',
    },
    title: {
        fontSize: 28,
        fontFamily: 'Inter-SemiBold',
        fontWeight: '600',
        marginBottom: 8,
        textAlign: 'center',
        letterSpacing: -0.5,
    },
    subtitle: {
        fontSize: 14,
        marginBottom: 24,
        lineHeight: 20,
        textAlign: 'center',
    },
    inputWrapper: {
        marginTop: 8,
        marginBottom: 8,
    },
    usernameInput: {
        borderWidth: 1,
        borderRadius: 12,
        padding: 16,
        fontSize: 16,
    },
    inputHint: {
        fontSize: 12,
        marginBottom: 8,
    },
    checkingText: {
        fontSize: 12,
        marginTop: 4,
    },
    availableText: {
        fontSize: 12,
        marginTop: 4,
        fontWeight: '600',
    },
    errorText: {
        color: '#DC3545',
        fontSize: 14,
        marginTop: 8,
        textAlign: 'center',
    },
    primaryButton: {
        padding: 18,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 24,
        minHeight: 56,
        justifyContent: 'center',
    },
    primaryButtonText: {
        fontSize: 16,
        fontFamily: 'Inter-SemiBold',
        fontWeight: '600',
    },
    cancelButton: {
        padding: 16,
        alignItems: 'center',
        marginTop: 8,
    },
    cancelText: {
        fontSize: 16,
    },
});

