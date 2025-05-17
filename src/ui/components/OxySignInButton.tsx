import React from 'react';
import { TouchableOpacity, Text, View, StyleSheet, ViewStyle, TextStyle, StyleProp, Platform } from 'react-native';
import { useOxy } from '../context/OxyContext';
import OxyLogo from './OxyLogo';
import { fontFamilies } from '../styles/fonts';

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
            // Expand the bottom sheet and immediately navigate to SignIn
            bottomSheetRef.current.expand();

            // Navigate immediately without delay
            // @ts-ignore - _navigateToScreen is added at runtime by OxyRouter
            bottomSheetRef.current._navigateToScreen?.('SignIn');
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

    // This function was previously used for logo container styling
    // Now removed as we're not using the container anymore

    return (
        <TouchableOpacity
            style={[styles.button, getButtonStyle(), disabled && styles.buttonDisabled]}
            onPress={handlePress}
            disabled={disabled}
        >
            <View style={styles.buttonContent}>
                <OxyLogo
                    width={20}
                    height={20}
                    fillColor={variant === 'contained' ? 'white' : '#d169e5'}
                    secondaryFillColor={variant === 'contained' ? '#d169e5' : undefined}
                    style={disabled ? { opacity: 0.6 } : undefined}
                />
                <Text style={[styles.text, getTextStyle(), disabled && styles.textDisabled]}>
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
        shadowColor: '#000000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
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
        fontWeight: Platform.OS === 'web' ? '600' : undefined, // Only apply fontWeight on web
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
