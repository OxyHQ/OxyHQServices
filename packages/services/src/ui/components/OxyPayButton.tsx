import type React from 'react';
import { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, type ViewStyle, type TextStyle, type StyleProp, type LayoutChangeEvent } from 'react-native';
import { fontFamilies } from '../styles/fonts';
import type { PaymentItem, PaymentGatewayResult } from '../screens/PaymentGatewayScreen';
import OxyLogo from './OxyLogo';

export interface OxyPayButtonProps {
    style?: StyleProp<ViewStyle>;
    textStyle?: StyleProp<TextStyle>;
    text?: string;
    disabled?: boolean;
    amount: number | string;
    currency?: string;
    paymentItems?: PaymentItem[];
    description?: string;
    onPaymentResult?: (result: PaymentGatewayResult) => void;
    /**
     * Button background color. If not provided, uses variant ('white' or 'black').
     */
    color?: string;
    /**
     * Button color variant: 'white' (default) or 'black'. Ignored if color is set.
     */
    variant?: 'white' | 'black';
}

/**
 * A pre-styled button for OxyPay payments that opens the Payment Gateway
 * - Only black or white by default, but can be customized with the color prop.
 */
const OxyPayButton: React.FC<OxyPayButtonProps> = ({
    style,
    textStyle,
    text = 'Pay',
    disabled = false,
    amount,
    currency = 'FAIR',
    paymentItems,
    description,
    onPaymentResult,
    color,
    variant = 'white',
}) => {
    const [buttonHeight, setButtonHeight] = useState<number>(52);
    const handlePress = () => {
        console.warn('OxyPayButton: The bottom sheet payment flow has been removed. Provide a custom onPress handler.');
    };
    // Determine background and text color
    const backgroundColor = color || (variant === 'black' ? '#111' : '#fff');
    const textColor = variant === 'black' || (color && isColorDark(color)) ? '#fff' : '#1b1f0a';
    // Responsive sizing
    const logoWidth = Math.round(buttonHeight * 0.5); // 50% of button height
    const logoHeight = Math.round(buttonHeight * 0.25); // 25% of button height
    const fontSize = Math.round(buttonHeight * 0.35); // 35% of button height
    const handleLayout = (e: LayoutChangeEvent) => {
        const h = e.nativeEvent.layout.height;
        if (h && Math.abs(h - buttonHeight) > 1) setButtonHeight(h);
    };
    return (
        <TouchableOpacity
            style={[styles.button, { backgroundColor, borderColor: textColor, borderWidth: 1 }, disabled && styles.buttonDisabled, style]}
            onPress={handlePress}
            disabled={disabled}
            activeOpacity={0.85}
            onLayout={handleLayout}
        >
            <View style={styles.buttonContent}>
                <OxyLogo
                    width={logoWidth}
                    height={logoHeight}
                    style={{ marginRight: logoWidth * 0.12, marginTop: (fontSize - logoHeight) / 2 }}
                    fillColor={textColor}
                />
                <Text style={[styles.text, { color: textColor, fontSize }, textStyle]}>{text}</Text>
            </View>
        </TouchableOpacity>
    );
};

// Helper to determine if a color is dark (simple luminance check)
function isColorDark(hex: string) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    if (c.length !== 6) return false;
    const r = Number.parseInt(c.substr(0, 2), 16);
    const g = Number.parseInt(c.substr(2, 2), 16);
    const b = Number.parseInt(c.substr(4, 2), 16);
    // Perceived luminance
    return (0.299 * r + 0.587 * g + 0.114 * b) < 150;
}

const styles = StyleSheet.create({
    button: {
        padding: 14,
        borderRadius: 35,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        minHeight: 52,
    },
    buttonDisabled: {
        opacity: 0.6,
    },
    buttonContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    oxyLogo: {
        // marginRight is set dynamically
    },
    centeredItem: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    text: {
        fontFamily: fontFamilies.inter,
        fontWeight: '700',
    },
});

export default OxyPayButton; 