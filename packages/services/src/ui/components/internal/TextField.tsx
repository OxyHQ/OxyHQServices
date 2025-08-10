import React, { useState, useCallback, forwardRef, useEffect, useRef, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    Platform,
    type TextInputProps,
    Animated,
    LayoutChangeEvent,
    AccessibilityInfo,
    type StyleProp,
    type ViewStyle,
    type NativeSyntheticEvent,
    type TargetedEvent,
    type TextInputFocusEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { fontFamilies } from '../../styles/fonts';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
    // Basic props
    label?: string;
    variant?: 'filled' | 'outlined' | 'standard';
    color?: 'primary' | 'secondary' | 'error' | 'success' | 'warning';

    // Leading and trailing elements
    leading?: React.ReactNode | ((props: { color: string; size: number }) => React.ReactNode | null) | null;
    trailing?: React.ReactNode | ((props: { color: string; size: number }) => React.ReactNode | null) | null;

    // States
    error?: string;
    success?: boolean;
    loading?: boolean;
    disabled?: boolean;

    // Helper text
    helperText?: string;

    // Enhanced features
    maxLength?: number;
    showCharacterCount?: boolean;
    inputMask?: 'phone' | 'creditCard' | 'currency' | 'custom';
    customMask?: (value: string) => string;
    formatValue?: (value: string) => string;
    validateOnChange?: boolean;
    debounceMs?: number;
    passwordStrength?: boolean;
    clearable?: boolean;

    // Mouse events (for web)
    onMouseEnter?: (event: NativeSyntheticEvent<TargetedEvent>) => void;
    onMouseLeave?: (event: NativeSyntheticEvent<TargetedEvent>) => void;

    // Styling
    style?: StyleProp<ViewStyle>;
    inputContainerStyle?: StyleProp<ViewStyle>;
    inputStyle?: TextInputProps['style'];
    leadingContainerStyle?: StyleProp<ViewStyle>;
    trailingContainerStyle?: StyleProp<ViewStyle>;

    // Callbacks
    onValidationChange?: (isValid: boolean, value: string) => void;
    onClear?: () => void;
}

// Color palette for different states
const colorPalette = {
    primary: {
        main: '#d169e5',
        light: '#e8b5f0',
        dark: '#a64db3',
    },
    secondary: {
        main: '#666666',
        light: '#999999',
        dark: '#333333',
    },
    error: {
        main: '#D32F2F',
        light: '#ffcdd2',
        dark: '#b71c1c',
    },
    success: {
        main: '#2E7D32',
        light: '#c8e6c9',
        dark: '#1b5e20',
    },
    warning: {
        main: '#FF9800',
        light: '#ffe0b2',
        dark: '#e65100',
    },
};

// Surface scale for consistent theming
const surfaceScale = (level: number) => {
    const base = 255;
    const value = Math.round(base - (level * 255));
    return `#${value.toString(16).padStart(2, '0').repeat(3)}`;
};

// Password strength calculation
const calculatePasswordStrength = (password: string): { score: number; feedback: string; color: string; label: string } => {
    if (!password) return { score: 0, feedback: '', color: '#E0E0E0', label: '' };

    let score = 0;
    const feedback: string[] = [];

    if (password.length >= 8) score += 25;
    else feedback.push('At least 8 characters');

    if (/[A-Z]/.test(password)) score += 25;
    else feedback.push('One uppercase letter');

    if (/[a-z]/.test(password)) score += 25;
    else feedback.push('One lowercase letter');

    if (/[\d\W]/.test(password)) score += 25;
    else feedback.push('One number or special character');

    const colors = {
        0: '#E0E0E0',
        25: '#D32F2F',
        50: '#FF9800',
        75: '#2196F3',
        100: '#4CAF50'
    };

    const labels = {
        0: '',
        25: 'Weak',
        50: 'Fair',
        75: 'Good',
        100: 'Strong'
    };

    return {
        score,
        feedback: score === 100 ? 'Strong password!' : `Missing: ${feedback.join(', ')}`,
        color: colors[score as keyof typeof colors] || colors[0],
        label: labels[score as keyof typeof labels] || ''
    };
};

// Input formatting utilities
const formatters = {
    phone: (value: string) => {
        const cleaned = value.replace(/\D/g, '');
        const match = cleaned.match(/^(\d{3})(\d{3})(\d{4})$/);
        if (match) return `(${match[1]}) ${match[2]}-${match[3]}`;
        return value;
    },
    creditCard: (value: string) => {
        const cleaned = value.replace(/\D/g, '');
        const match = cleaned.match(/^(\d{4})(\d{4})(\d{4})(\d{4})$/);
        if (match) return `${match[1]} ${match[2]} ${match[3]} ${match[4]}`;
        return value.replace(/(.{4})/g, '$1 ').trim();
    },
    currency: (value: string) => {
        const cleaned = value.replace(/[^\d.]/g, '');
        const num = Number.parseFloat(cleaned);
        return isNaN(num) ? value : `$${num.toFixed(2)}`;
    }
};

// Debounce hook
const useDebounce = (value: string, delay: number) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
};

const TextField = forwardRef<TextInput, TextFieldProps>(({
    // Basic props
    label,
    variant = 'filled',
    color = 'primary',

    // Leading and trailing
    leading,
    trailing,

    // States
    error,
    success = false,
    loading = false,
    disabled = false,

    // Helper text
    helperText,

    // Enhanced features
    maxLength,
    showCharacterCount,
    inputMask,
    customMask,
    formatValue,
    validateOnChange,
    debounceMs = 300,
    passwordStrength = false,
    clearable = false,

    // Mouse events
    onMouseEnter,
    onMouseLeave,

    // Styling
    style,
    inputContainerStyle,
    inputStyle,
    leadingContainerStyle,
    trailingContainerStyle,

    // Callbacks
    onValidationChange,
    onClear,

    // TextInput props
    placeholder,
    onFocus,
    onBlur,
    onChangeText,
    value = '',
    secureTextEntry,
    ...rest
}, ref) => {
    // State management
    const [focused, setFocused] = useState(false);
    const [hovered, setHovered] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [internalValue, setInternalValue] = useState(value);
    const [isValidating, setIsValidating] = useState(false);

    // Refs
    const focusAnimation = useRef(new Animated.Value(0)).current;
    const activeAnimation = useRef(new Animated.Value(Boolean(value) ? 1 : 0)).current;
    const inputRef = useRef<TextInput>(null);

    // Get color palette
    const palette = colorPalette[color] || colorPalette.primary;

    // Determine if we should show error colors
    const effectiveColor = error ? 'error' : success ? 'success' : color;
    const effectivePalette = colorPalette[effectiveColor] || colorPalette.primary;

    // Get icon color based on focus state and error state
    const iconColor = error
        ? effectivePalette.main  // Always show error color when there's an error
        : focused
            ? effectivePalette.main
            : surfaceScale(0.62);

    // Helper function to clone React elements with updated color
    const cloneWithColor = (element: React.ReactNode, color: string): React.ReactNode => {
        if (React.isValidElement(element) && element.type) {
            // Avoid spreading props directly to satisfy TS complaining about non-object spread sources
            return React.cloneElement(element as any, { color });
        }
        return element;
    };

    // Render leading/trailing elements
    const leadingNode = typeof leading === 'function'
        ? leading({ color: iconColor, size: 24 })
        : cloneWithColor(leading, iconColor);

    const trailingNode = typeof trailing === 'function'
        ? trailing({ color: iconColor, size: 24 })
        : cloneWithColor(trailing, iconColor);

    // Debounced value for validation
    const debouncedValue = useDebounce(internalValue, debounceMs);

    // Password strength calculation
    const passwordStrengthData = useMemo(() => {
        if (passwordStrength && secureTextEntry && internalValue) {
            return calculatePasswordStrength(internalValue);
        }
        return null;
    }, [passwordStrength, secureTextEntry, internalValue]);

    // Format input value
    const formatInputValue = useCallback((text: string): string => {
        if (formatValue) return formatValue(text);
        if (inputMask && inputMask !== 'custom' && formatters[inputMask as keyof typeof formatters]) {
            return formatters[inputMask as keyof typeof formatters](text);
        }
        if (customMask) return customMask(text);
        return text;
    }, [formatValue, inputMask, customMask]);

    // Handle focus
    const handleFocus = useCallback((event: NativeSyntheticEvent<TextInputFocusEventData>) => {
        if (disabled) return;
        setFocused(true);
        onFocus?.(event);
    }, [disabled, onFocus]);

    // Handle blur
    const handleBlur = useCallback((event: NativeSyntheticEvent<TextInputFocusEventData>) => {
        setFocused(false);
        onBlur?.(event);
    }, [onBlur]);

    // Handle mouse events
    const handleMouseEnter = useCallback((event: NativeSyntheticEvent<TargetedEvent>) => {
        onMouseEnter?.(event);
        setHovered(true);
    }, [onMouseEnter]);

    const handleMouseLeave = useCallback((event: NativeSyntheticEvent<TargetedEvent>) => {
        onMouseLeave?.(event);
        setHovered(false);
    }, [onMouseLeave]);

    // Handle text change
    const handleChangeText = useCallback((text: string) => {
        const formattedText = formatInputValue(text);
        setInternalValue(formattedText);
        onChangeText?.(formattedText);
    }, [formatInputValue, onChangeText]);

    // Handle clear
    const handleClear = useCallback(() => {
        setInternalValue('');
        onChangeText?.('');
        onClear?.();
        inputRef.current?.focus();
    }, [onChangeText, onClear]);

    // Toggle password visibility
    const togglePasswordVisibility = useCallback(() => {
        setShowPassword(prev => !prev);
    }, []);

    // Animate focus state
    useEffect(() => {
        Animated.timing(focusAnimation, {
            toValue: focused ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [focused, focusAnimation]);

    // Animate active state (when focused or has value)
    useEffect(() => {
        const shouldBeActive = focused || Boolean(internalValue);
        Animated.timing(activeAnimation, {
            toValue: shouldBeActive ? 1 : 0,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [focused, internalValue, activeAnimation]);

    // Validation effect
    useEffect(() => {
        if (!validateOnChange || !onValidationChange) return;

        const timer = setTimeout(() => {
            setIsValidating(true);
            const isValid = !error && debouncedValue.length > 0;
            onValidationChange(isValid, debouncedValue);
            setIsValidating(false);
        }, 100);

        return () => clearTimeout(timer);
    }, [debouncedValue, validateOnChange, onValidationChange, error]);

    // Update internal value when prop changes
    useEffect(() => {
        setInternalValue(value);
    }, [value]);

    // Styles
    const styles = useMemo(() => {
        const isActive = focused || Boolean(internalValue);

        return StyleSheet.create({
            container: {
                width: '100%',
                marginBottom: 24,
            },
            inputContainer: {
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: variant === 'standard' ? 48 : 56,
                backgroundColor: variant === 'filled'
                    ? focused
                        ? surfaceScale(0.08)
                        : hovered
                            ? surfaceScale(0.08)
                            : surfaceScale(0.04)
                    : 'transparent',
                borderRadius: variant === 'standard' ? 0 : (variant === 'filled' ? 16 : 8),
                borderTopLeftRadius: variant === 'filled' ? 16 : undefined,
                borderTopRightRadius: variant === 'filled' ? 16 : undefined,
                borderBottomLeftRadius: variant === 'filled' ? 0 : undefined,
                borderBottomRightRadius: variant === 'filled' ? 0 : undefined,
                borderWidth: variant === 'outlined' ? (focused ? 2 : 1) : 0,
                borderColor: error
                    ? effectivePalette.main  // Always show error color when there's an error
                    : focused
                        ? effectivePalette.main
                        : hovered
                            ? surfaceScale(0.87)
                            : surfaceScale(0.42),
                position: 'relative',
                ...Platform.select({
                    web: {
                        outlineStyle: 'none',
                        outlineWidth: 0,
                        outlineOffset: 0,
                    },
                    default: {},
                }),
            },
            input: {
                flex: 1,
                minHeight: variant === 'standard' ? 48 : 56,
                paddingStart: leadingNode ? 12 : variant === 'standard' ? 0 : 16,
                paddingEnd: (trailingNode || clearable || secureTextEntry) ? 12 : variant === 'standard' ? 0 : 16,
                paddingTop: variant === 'filled' && label ? 18 : 0,
                color: surfaceScale(0.87),
                fontSize: 16,
                borderWidth: 0,
                backgroundColor: 'transparent',
                ...Platform.select({
                    web: {
                        border: 'none',
                        outlineStyle: 'none',
                        outlineWidth: 0,
                        outlineOffset: 0,
                        boxShadow: 'none',
                        '-webkit-appearance': 'none',
                        '-moz-appearance': 'none',
                        appearance: 'none',
                    },
                    default: {},
                }),
            },
            leading: {
                justifyContent: 'center',
                alignItems: 'center',
                width: 24,
                height: 24,
                marginStart: variant === 'standard' ? 0 : 12,
                marginVertical: variant === 'standard' ? 12 : 16,
            },
            trailing: {
                flexDirection: 'row',
                justifyContent: 'center',
                alignItems: 'center',
                marginEnd: variant === 'standard' ? 0 : 12,
                marginVertical: variant === 'standard' ? 12 : 16,
            },
            underline: {
                position: 'absolute',
                start: 0,
                end: 0,
                bottom: 0,
                height: 1,
                backgroundColor: error
                    ? effectivePalette.main  // Always show error color when there's an error
                    : hovered
                        ? surfaceScale(0.87)
                        : surfaceScale(0.42),
            },
            underlineFocused: {
                position: 'absolute',
                start: 0,
                end: 0,
                bottom: 0,
                height: 2,
                backgroundColor: effectivePalette.main,
            },
            labelContainer: {
                justifyContent: 'center',
                position: 'absolute',
                top: 0,
                start: variant === 'standard' ? (leadingNode ? 36 : 0) : leadingNode ? 48 : 16,
                height: variant === 'standard' ? 48 : 56,
            },
            label: {
                fontSize: 16,
                fontFamily: fontFamilies.phuduSemiBold,
                color: surfaceScale(0.87),
            },
            helperText: {
                fontSize: 12,
                fontFamily: fontFamilies.phuduMedium,
                marginTop: 4,
                marginHorizontal: 16,
                color: surfaceScale(0.6),
            },

            passwordStrengthContainer: {
                marginTop: 8,
                marginHorizontal: 16,
            },
            passwordStrengthBar: {
                height: 4,
                backgroundColor: '#E0E0E0',
                borderRadius: 2,
                overflow: 'hidden',
            },
            passwordStrengthFill: {
                height: '100%',
                borderRadius: 2,
            },
            passwordStrengthText: {
                fontSize: 11,
                fontWeight: '600',
                marginTop: 4,
            },
            characterCount: {
                fontSize: 11,
                marginTop: 4,
                marginHorizontal: 16,
                textAlign: 'right',
                color: surfaceScale(0.6),
            },
            clearButton: {
                padding: 4,
                marginLeft: 8,
            },
            passwordToggle: {
                padding: 4,
                marginLeft: 8,
            },
            validationIndicator: {
                marginLeft: 8,
            },
        });
    }, [variant, focused, hovered, effectivePalette, leadingNode, trailingNode, clearable, secureTextEntry, label, error, internalValue]);

    // Character count display
    const characterCount = internalValue.length;
    const showCount = showCharacterCount && maxLength;

    // Render password strength indicator
    const renderPasswordStrength = () => {
        if (!passwordStrengthData) return null;

        return (
            <View style={styles.passwordStrengthContainer}>
                <View style={styles.passwordStrengthBar}>
                    <View
                        style={[
                            styles.passwordStrengthFill,
                            {
                                width: `${passwordStrengthData.score}%`,
                                backgroundColor: passwordStrengthData.color
                            }
                        ]}
                    />
                </View>
                <Text style={[styles.passwordStrengthText, { color: passwordStrengthData.color }]}>
                    {passwordStrengthData.label}
                </Text>
            </View>
        );
    };

    // Render character count
    const renderCharacterCount = () => {
        if (!showCount) return null;

        return (
            <Text style={styles.characterCount}>
                {characterCount}/{maxLength}
            </Text>
        );
    };

    // Get helper text content (error takes precedence over helper text)
    const helperTextContent = error || helperText;

    // Render trailing elements
    const renderTrailingElements = () => {
        const elements = [];

        // Loading indicator
        if (isValidating) {
            elements.push(
                <ActivityIndicator
                    key="validating"
                    size="small"
                    color={effectivePalette.main}
                    style={styles.validationIndicator}
                />
            );
        }

        // Loading indicator
        if (loading && !isValidating) {
            elements.push(
                <ActivityIndicator
                    key="loading"
                    size="small"
                    color={effectivePalette.main}
                    style={styles.validationIndicator}
                />
            );
        }

        // Success indicator
        if (success && !loading && !isValidating) {
            elements.push(
                <Ionicons
                    key="success"
                    name="checkmark-circle"
                    size={22}
                    color={colorPalette.success.main}
                    style={styles.validationIndicator}
                />
            );
        }

        // Clear button
        if (clearable && internalValue && !secureTextEntry) {
            elements.push(
                <TouchableOpacity
                    key="clear"
                    style={styles.clearButton}
                    onPress={handleClear}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel="Clear input"
                    accessibilityRole="button"
                >
                    <Ionicons
                        name="close-circle"
                        size={20}
                        color={iconColor}
                    />
                </TouchableOpacity>
            );
        }

        // Password toggle
        if (secureTextEntry) {
            elements.push(
                <TouchableOpacity
                    key="password"
                    style={styles.passwordToggle}
                    onPress={togglePasswordVisibility}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel={showPassword ? "Hide password" : "Show password"}
                    accessibilityRole="button"
                >
                    <Ionicons
                        name={showPassword ? "eye-off" : "eye"}
                        size={22}
                        color={iconColor}
                    />
                </TouchableOpacity>
            );
        }

        return elements;
    };

    return (
        <View
            style={[styles.container, style]}
            {...(Platform.OS === 'web' && { className: 'oxy-textfield-container' })}
        >
            <View
                style={[
                    styles.inputContainer,
                    inputContainerStyle,
                ]}
                {...(Platform.OS === 'web' && {
                    onMouseEnter: handleMouseEnter,
                    onMouseLeave: handleMouseLeave,
                })}
            >
                {/* Leading element */}
                {leadingNode && (
                    <View style={[styles.leading, leadingContainerStyle]}>
                        {leadingNode}
                    </View>
                )}

                {/* Text Input */}
                <TextInput
                    ref={(r) => {
                        if (typeof ref === 'function') {
                            ref(r);
                        } else if (ref && typeof ref === 'object') {
                            // @ts-ignore - React ref assignment
                            ref.current = r;
                        }
                        // @ts-ignore - Internal ref assignment
                        inputRef.current = r;
                    }}
                    style={[styles.input, inputStyle]}
                    placeholder={label ? (focused ? placeholder : undefined) : placeholder}
                    placeholderTextColor={surfaceScale(0.4)}
                    selectionColor={effectivePalette.main}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    onChangeText={handleChangeText}
                    secureTextEntry={secureTextEntry && !showPassword}
                    value={internalValue}
                    editable={!disabled}
                    maxLength={maxLength}
                    {...(Platform.OS === 'web' && { className: 'oxy-textfield-input' })}
                    {...rest}
                />

                {/* Trailing elements */}
                <View style={[styles.trailing, trailingContainerStyle]}>
                    {trailingNode}
                    {renderTrailingElements()}
                </View>

                {/* Underline for filled/standard variants */}
                {(variant === 'filled' || variant === 'standard') && (
                    <>
                        <View style={styles.underline} pointerEvents="none" />
                        <Animated.View
                            style={[
                                styles.underlineFocused,
                                { transform: [{ scaleX: focusAnimation }] }
                            ]}
                            pointerEvents="none"
                        />
                    </>
                )}

                {/* Label */}
                {label && (
                    <View style={styles.labelContainer} pointerEvents="none">
                        <Animated.Text
                            style={[
                                styles.label,
                                {
                                    color: focusAnimation.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [
                                            error ? effectivePalette.main : surfaceScale(0.87),
                                            effectivePalette.main
                                        ],
                                    }),
                                    fontSize: activeAnimation.interpolate({
                                        inputRange: [0, 1],
                                        outputRange: [16, 12],
                                    }),
                                    transform: [
                                        {
                                            translateY: activeAnimation.interpolate({
                                                inputRange: [0, 1],
                                                outputRange: [0, variant === 'filled' ? -12 : variant === 'outlined' ? -28 : -24],
                                            }),
                                        },
                                    ],
                                },
                            ]}
                        >
                            {label}
                        </Animated.Text>
                    </View>
                )}
            </View>

            {/* Helper text or error message */}
            {helperTextContent && (
                <Text style={[
                    styles.helperText,
                    error && { color: effectivePalette.main }
                ]}>
                    {helperTextContent}
                </Text>
            )}

            {/* Password strength indicator */}
            {renderPasswordStrength()}

            {/* Character count */}
            {renderCharacterCount()}
        </View>
    );
});

TextField.displayName = 'TextField';

export default TextField; 