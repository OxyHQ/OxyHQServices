import type React from 'react';
import { useCallback, useState, useEffect, useMemo } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, type ViewStyle, type TextStyle, type StyleProp, Platform } from 'react-native';
import { useAuthStore } from '../stores/authStore';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '@oxyhq/bloom/theme';
import { fontFamilies } from '../styles/fonts';
import OxyLogo from './OxyLogo';
import { showSignInModal, subscribeToSignInModal } from './SignInModal';

export interface OxySignInButtonProps {
    /**
     * Controls the appearance of the button
     * @default 'default'
     */
    variant?: 'default' | 'outline' | 'contained';

    /**
     * Optional function to handle button press
     * If not provided, the button will use the showBottomSheet method from OxyContext
     */
    onPress?: () => void;

    /**
     * Additional styles for the button container
     */
    style?: StyleProp<ViewStyle>;

    /**
     * Additional styles for the button text
     */
    textStyle?: StyleProp<TextStyle>;

    /**
     * Custom button text
     * @default 'Sign in with Oxy'
     */
    text?: string;

    /**
     * Whether to disable the button
     * @default false
     */
    disabled?: boolean;

    /**
     * Whether to show the button even if user is already authenticated
     * @default false
     */
    showWhenAuthenticated?: boolean;
}

/**
 * A pre-styled button component for signing in with Oxy identity
 *
 * This component opens the Oxy Auth flow which allows users to authenticate
 * using their Oxy Accounts identity (via QR code or deep link).
 *
 * @example
 * ```tsx
 * // Basic usage
 * <OxySignInButton />
 *
 * // Custom styling
 * <OxySignInButton
 *   variant="contained"
 *   style={{ marginTop: 20 }}
 *   text="Login with Oxy"
 * />
 *
 * // Custom handler
 * <OxySignInButton onPress={() => {
 *   // Custom authentication flow
 * }} />
 * ```
 */
export const OxySignInButton: React.FC<OxySignInButtonProps> = ({
    variant = 'default',
    onPress,
    style,
    textStyle,
    text = 'Sign in with Oxy',
    disabled = false,
    showWhenAuthenticated = false,
}) => {
    const theme = useTheme();
    const { isAuthenticated, isLoading } = useAuthStore(
        useShallow((state) => ({ isAuthenticated: state.isAuthenticated, isLoading: state.isLoading }))
    );
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Subscribe to modal close events
    useEffect(() => {
        return subscribeToSignInModal(setIsModalOpen);
    }, []);

    // Handle button press - opens full-screen sign-in modal with QR code and auth options
    const handlePress = useCallback(() => {
        if (onPress) {
            onPress();
            return;
        }

        setIsModalOpen(true);
        // Show the full-screen sign-in modal on all platforms
        showSignInModal();
    }, [onPress]);

    const themedStyles = useMemo(() => StyleSheet.create({
        button: {
            padding: 14,
            borderRadius: 35,
            alignItems: 'center',
            justifyContent: 'center',
        },
        buttonDefault: {
            backgroundColor: '#FFFFFF',
            borderWidth: 1,
            borderColor: theme.colors.borderLight,
            ...Platform.select({
                web: {
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                },
                default: {
                    shadowColor: '#000000',
                    shadowOffset: { width: 0, height: 2 },
                    shadowOpacity: 0.1,
                    shadowRadius: 4,
                    elevation: 2,
                }
            }),
        },
        buttonOutline: {
            backgroundColor: 'transparent',
            borderWidth: 1,
            borderColor: theme.colors.primary,
        },
        buttonContained: {
            backgroundColor: theme.colors.primary,
        },
        buttonDisabled: {
            opacity: 0.6,
        },
        buttonContent: {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
        },
        text: {
            fontFamily: fontFamilies.interSemiBold,
            fontWeight: Platform.OS === 'web' ? '600' : undefined,
            fontSize: 16,
            marginLeft: 10,
        },
        textDefault: {
            color: theme.colors.text,
        },
        textOutline: {
            color: theme.colors.primary,
        },
        textContained: {
            color: '#FFFFFF',
        },
        textDisabled: {
            color: theme.colors.textTertiary,
        },
    }), [theme]);

    // Don't show the button if already authenticated (unless explicitly overridden)
    if (isAuthenticated && !showWhenAuthenticated) return null;

    const isButtonDisabled = disabled || isLoading || isModalOpen;

    // Determine the button style based on the variant
    const getButtonStyle = () => {
        switch (variant) {
            case 'outline':
                return [themedStyles.buttonOutline, style];
            case 'contained':
                return [themedStyles.buttonContained, style];
            default:
                return [themedStyles.buttonDefault, style];
        }
    };

    // Determine the text style based on the variant
    const getTextStyle = () => {
        switch (variant) {
            case 'outline':
                return [themedStyles.textOutline, textStyle];
            case 'contained':
                return [themedStyles.textContained, textStyle];
            default:
                return [themedStyles.textDefault, textStyle];
        }
    };

    return (
        <TouchableOpacity
            style={[themedStyles.button, getButtonStyle(), isButtonDisabled && themedStyles.buttonDisabled]}
            onPress={handlePress}
            disabled={isButtonDisabled}
        >
            <View style={themedStyles.buttonContent}>
                <OxyLogo
                    variant="icon"
                    size={20}
                    fillColor={variant === 'contained' ? 'white' : theme.colors.primary}
                    innerFillColor={variant === 'contained' ? theme.colors.primary : undefined}
                    style={isButtonDisabled ? { opacity: 0.6 } : undefined}
                />
                <Text style={[themedStyles.text, getTextStyle(), isButtonDisabled && themedStyles.textDisabled]}>
                    {isLoading || isModalOpen ? 'Signing in...' : text}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

export default OxySignInButton;
