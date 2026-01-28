import type React from 'react';
import { useCallback } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, type ViewStyle, type TextStyle, type StyleProp, Platform } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { fontFamilies } from '../styles/fonts';
import OxyLogo from './OxyLogo';
import { showBottomSheet } from '../navigation/bottomSheetManager';

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
 *   console.log('Custom auth flow initiated');
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
    const { isAuthenticated, isLoading } = useAuth();

    // Don't show the button if already authenticated (unless explicitly overridden)
    if (isAuthenticated && !showWhenAuthenticated) return null;

    // Handle button press - opens OxyAuth bottom sheet with QR code and sign-in options
    const handlePress = useCallback(() => {
        if (onPress) {
            onPress();
            return;
        }

        // Show the OxyAuth bottom sheet on all platforms
        // This provides QR code scanning and "Open Oxy Auth" button
        showBottomSheet('OxyAuth');
    }, [onPress]);

    const isButtonDisabled = disabled || isLoading;

    // Determine the button style based on the variant
    const getButtonStyle = () => {
        switch (variant) {
            case 'outline':
                return [styles.buttonOutline, style];
            case 'contained':
                return [styles.buttonContained, style];
            default:
                return [styles.buttonDefault, style];
        }
    };

    // Determine the text style based on the variant
    const getTextStyle = () => {
        switch (variant) {
            case 'outline':
                return [styles.textOutline, textStyle];
            case 'contained':
                return [styles.textContained, textStyle];
            default:
                return [styles.textDefault, textStyle];
        }
    };

    return (
        <TouchableOpacity
            style={[styles.button, getButtonStyle(), isButtonDisabled && styles.buttonDisabled]}
            onPress={handlePress}
            disabled={isButtonDisabled}
        >
            <View style={styles.buttonContent}>
                <OxyLogo
                    width={20}
                    height={20}
                    fillColor={variant === 'contained' ? 'white' : '#d169e5'}
                    secondaryFillColor={variant === 'contained' ? '#d169e5' : undefined}
                    style={isButtonDisabled ? { opacity: 0.6 } : undefined}
                />
                <Text style={[styles.text, getTextStyle(), isButtonDisabled && styles.textDisabled]}>
                    {text}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    button: {
        padding: 14,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonDefault: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#DDDDDD',
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
        borderColor: '#d169e5',
    },
    buttonContained: {
        backgroundColor: '#d169e5',
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
        color: '#333333',
    },
    textOutline: {
        color: '#d169e5',
    },
    textContained: {
        color: '#FFFFFF',
    },
    textDisabled: {
        color: '#888888',
    },
});

export default OxySignInButton;
