import type React from 'react';
import { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, type ViewStyle, type TextStyle, type StyleProp, Platform } from 'react-native';
import { useAuth } from '../hooks/useAuth';
import OxyLogo from './OxyLogo';

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
    const { isAuthenticated, signIn, isLoading } = useAuth();
    const [isSigningIn, setIsSigningIn] = useState(false);

    // Don't show the button if already authenticated (unless explicitly overridden)
    if (isAuthenticated && !showWhenAuthenticated) return null;

    // Default handler that uses useAuth's signIn method
    // This works for both web (popup) and native (bottom sheet)
    const handlePress = async () => {
        if (onPress) {
            onPress();
            return;
        }

        if (isSigningIn) return;

        setIsSigningIn(true);
        try {
            await signIn();
        } catch (error) {
            // Sign-in handled by the auth flow
            if (__DEV__) {
                console.log('OxySignInButton: Sign-in flow initiated', error);
            }
        } finally {
            setIsSigningIn(false);
        }
    };

    const isButtonDisabled = disabled || isLoading || isSigningIn;

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
                    {isSigningIn ? 'Signing in...' : text}
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
        fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-SemiBold',
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
