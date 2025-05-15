import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet, ViewStyle, TextStyle, StyleProp } from 'react-native';
import { useOxy } from '../context/OxyContext';

export interface OxySignInButtonProps {
    /**
     * Controls the appearance of the button
     * @default 'default'
     */
    variant?: 'default' | 'outline' | 'contained';

    /**
     * Optional function to handle button press
     * If not provided, the button will attempt to use bottomSheetRef from OxyContext
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
     * Delay in milliseconds before navigating to SignIn screen after expanding
     * Only used when using bottomSheetRef automatic navigation
     * @default 300
     */
    navigationDelay?: number;

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
 * A pre-styled button component for signing in with Oxy services
 * 
 * This component automatically integrates with the OxyProvider context
 * and will control the authentication bottom sheet when pressed.
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
    navigationDelay = 300,
    disabled = false,
    showWhenAuthenticated = false,
}) => {
    const { user, bottomSheetRef } = useOxy();

    // Don't show the button if already authenticated (unless explicitly overridden)
    if (user && !showWhenAuthenticated) return null;

    // Default handler that uses the bottomSheetRef from OxyContext
    const handlePress = () => {
        if (onPress) {
            onPress();
            return;
        }

        // Default behavior: open the bottom sheet and navigate to SignIn
        if (bottomSheetRef?.current) {
            bottomSheetRef.current.expand();

            // Use setTimeout to ensure the sheet is open before trying to navigate
            setTimeout(() => {
                if (bottomSheetRef?.current) {
                    // @ts-ignore - _navigateToScreen is added at runtime by OxyRouter
                    bottomSheetRef.current._navigateToScreen?.('SignIn');
                }
            }, navigationDelay);
        } else {
            console.warn('OxySignInButton: bottomSheetRef is not available. Either provide an onPress prop or ensure this component is used within an OxyProvider.');
        }
    };

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
            style={[styles.button, getButtonStyle(), disabled && styles.buttonDisabled]}
            onPress={handlePress}
            disabled={disabled}
        >
            <View style={styles.buttonContent}>
                <View style={styles.logoContainer}>
                    <Text style={styles.logoText}>O</Text>
                </View>
                <Text style={[styles.text, getTextStyle(), disabled && styles.textDisabled]}>
                    {text}
                </Text>
            </View>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    button: {
        padding: 12,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonDefault: {
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: '#DDDDDD',
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    buttonOutline: {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: '#5A5AFF',
    },
    buttonContained: {
        backgroundColor: '#5A5AFF',
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
        fontWeight: '600',
        fontSize: 16,
        marginLeft: 10,
    },
    textDefault: {
        color: '#333333',
    },
    textOutline: {
        color: '#5A5AFF',
    },
    textContained: {
        color: '#FFFFFF',
    },
    textDisabled: {
        color: '#888888',
    },
    logoContainer: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: '#5A5AFF',
        justifyContent: 'center',
        alignItems: 'center',
    },
    logoText: {
        color: 'white',
        fontWeight: 'bold',
        fontSize: 16,
    },
});

export default OxySignInButton;
