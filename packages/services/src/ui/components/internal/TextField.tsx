import React, { useState, useCallback, forwardRef, useEffect, useRef, useMemo } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ActivityIndicator,
    StyleSheet,
    Platform,
    TextInputProps,
    Animated,
    LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { Animated as RNAnimated } from 'react-native';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
    label?: string;
    icon?: string;
    iconColor?: string;
    error?: string;
    success?: boolean;
    loading?: boolean;
    rightComponent?: React.ReactNode;
    leftComponent?: React.ReactNode;
    colors?: any;
    containerStyle?: any;
    inputStyle?: any;
    labelStyle?: any;
    errorStyle?: any;
    variant?: 'outlined' | 'filled';
    onFocus?: () => void;
    onBlur?: () => void;
    onChangeText?: (text: string) => void;
    testID?: string;
}

const TextField = forwardRef<TextInput, TextFieldProps>(({
    label,
    icon,
    iconColor,
    error,
    success = false,
    loading = false,
    rightComponent,
    leftComponent,
    colors,
    containerStyle,
    inputStyle,
    labelStyle,
    errorStyle,
    variant = 'outlined',
    onFocus,
    onBlur,
    onChangeText,
    testID,
    secureTextEntry,
    value = '',
    ...textInputProps
}, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const [isLabelFloating, setIsLabelFloating] = useState(value ? true : false);
    const [labelWidth, setLabelWidth] = useState(0);
    const [labelLeft, setLabelLeft] = useState(0);
    const [inputWidth, setInputWidth] = useState(0);
    const [inputHeight, setInputHeight] = useState(64);
    const borderRadius = 16;
    const borderWidth = 2;

    // Animation values
    const labelAnim = useRef(new Animated.Value(value ? 1 : 0)).current;
    const borderAnim = useRef(new Animated.Value(0)).current;

    const handleFocus = useCallback(() => {
        setIsFocused(true);
        onFocus?.();

        // Animate label to top
        Animated.timing(labelAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false,
        }).start();

        // Animate border
        Animated.timing(borderAnim, {
            toValue: 1,
            duration: 200,
            useNativeDriver: false,
        }).start();
    }, [onFocus, labelAnim, borderAnim]);

    const handleBlur = useCallback(() => {
        setIsFocused(false);
        onBlur?.();

        // Animate border back
        Animated.timing(borderAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
        }).start();

        // Keep label at top if there's a value
        if (!value) {
            Animated.timing(labelAnim, {
                toValue: 0,
                duration: 200,
                useNativeDriver: false,
            }).start();
        }
    }, [onBlur, borderAnim, labelAnim, value]);

    const handleChangeText = useCallback((text: string) => {
        onChangeText?.(text);

        // Animate label if value changes from empty to filled or vice versa
        const shouldShowLabel = text.length > 0;

        if (shouldShowLabel !== isLabelFloating) {
            setIsLabelFloating(shouldShowLabel);
            Animated.timing(labelAnim, {
                toValue: shouldShowLabel ? 1 : 0,
                duration: 200,
                useNativeDriver: false,
            }).start();
        }
    }, [onChangeText, labelAnim, isLabelFloating]);

    // Initialize label position based on current value
    useEffect(() => {
        if (value && !isLabelFloating) {
            setIsLabelFloating(true);
            labelAnim.setValue(1);
        }
    }, [value, isLabelFloating, labelAnim]);

    const togglePasswordVisibility = useCallback(() => {
        setShowPassword(!showPassword);
    }, [showPassword]);

    const getBorderColor = () => {
        if (error) return colors?.error || '#D32F2F';
        if (success) return colors?.success || '#2E7D32';
        if (isFocused) return colors?.primary || '#d169e5';
        return colors?.border || '#E0E0E0';
    };

    const getIconColor = () => {
        if (isFocused) return colors?.primary || '#d169e5';
        return iconColor || colors?.secondaryText || '#666666';
    };

    const getLabelColor = () => {
        if (error) return colors?.error || '#D32F2F';
        if (isFocused) return colors?.primary || '#d169e5';
        return colors?.secondaryText || '#666666';
    };

    const getBackgroundColor = () => {
        if (variant === 'filled') {
            return colors?.inputBackground || '#F5F5F5';
        }
        return 'transparent';
    };

    const styles = createStyles(colors, variant);

    const BASE_PADDING = 20;
    const ICON_WIDTH = 22;
    const ICON_MARGIN = 12;
    const TEXT_LEFT = (icon || leftComponent) ? BASE_PADDING + ICON_WIDTH + ICON_MARGIN : BASE_PADDING;
    const FLOAT_LEFT_OFFSET = 10;

    const isLabelFloated = Boolean(value || isFocused);

    // For web, make TextInput the primary element with absolute positioned decorations
    if (Platform.OS === 'web') {
        return (
            <View style={[styles.container, containerStyle]}>
                <View style={styles.webInputContainer}>
                    {/* TextInput as the primary element */}
                    <TextInput
                        ref={ref}
                        style={[
                            styles.webInput,
                            {
                                color: colors?.text || '#000000',
                                borderColor: 'transparent',
                                backgroundColor: getBackgroundColor(),
                                paddingLeft: TEXT_LEFT,
                                paddingRight: 60, // Space for right components
                                paddingTop: label ? 24 : 20, // Make room for floated label
                                paddingBottom: 8,
                                borderWidth: 0,
                                ...Platform.select({
                                    web: { border: 'none', outline: 'none', boxShadow: 'none' },
                                    default: {},
                                }),
                            },
                            inputStyle
                        ]}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        onChangeText={handleChangeText}
                        secureTextEntry={secureTextEntry && !showPassword}
                        placeholderTextColor="transparent"
                        testID={testID}
                        autoComplete={secureTextEntry ? 'current-password' : 'off'}
                        spellCheck={false}
                        value={value}
                        {...textInputProps}
                    />

                    {/* SVG border with a gap for the floating label */}
                    <Svg
                        width={inputWidth}
                        height={inputHeight}
                        style={{ position: 'absolute', top: 0, left: 0, zIndex: 0 }}
                        pointerEvents="none"
                    >
                        {/* Calculate the path for the border with rounded corners and a gap for the label */}
                        <Path
                            d={(() => {
                                const y = borderWidth / 2;
                                const x1 = borderRadius + borderWidth / 2;
                                const x2 = inputWidth - borderRadius - borderWidth / 2;
                                const labelGapStart = isLabelFloated ? labelLeft - 4 : x1;
                                const labelGapEnd = isLabelFloated ? labelLeft + labelWidth + 4 : x2;
                                // Start at left arc
                                return `M${x1},${y}` +
                                    ` A${borderRadius},${borderRadius} 0 0 1 ${borderWidth / 2},${y + borderRadius}` +
                                    ` L${borderWidth / 2},${inputHeight - borderRadius - borderWidth / 2}` +
                                    ` A${borderRadius},${borderRadius} 0 0 1 ${x1},${inputHeight - borderWidth / 2}` +
                                    ` L${x2},${inputHeight - borderWidth / 2}` +
                                    ` A${borderRadius},${borderRadius} 0 0 1 ${inputWidth - borderWidth / 2},${inputHeight - borderRadius - borderWidth / 2}` +
                                    ` L${inputWidth - borderWidth / 2},${y + borderRadius}` +
                                    ` A${borderRadius},${borderRadius} 0 0 1 ${x2},${y}` +
                                    ` L${labelGapStart},${y}` +
                                    ` M${labelGapEnd},${y}` +
                                    ` L${x2},${y}`;
                            })()}
                            stroke={getBorderColor()}
                            strokeWidth={borderWidth}
                            fill="none"
                        />
                    </Svg>

                    {/* Floating label */}
                    {label && (
                        <Animated.Text
                            onLayout={e => {
                                setLabelWidth(e.nativeEvent.layout.width);
                                setLabelLeft(e.nativeEvent.layout.x);
                            }}
                            style={[
                                styles.webFloatingLabel,
                                {
                                    color: getLabelColor(),
                                    left: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [TEXT_LEFT, FLOAT_LEFT_OFFSET] }),
                                    top: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [20, -14] }),
                                    fontSize: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 12] }),
                                    backgroundColor: 'transparent',
                                    paddingHorizontal: 4,
                                    zIndex: 2,
                                },
                                labelStyle
                            ]}
                        >
                            {label}
                        </Animated.Text>
                    )}

                    {/* Left Icon - positioned absolutely */}
                    {icon && !leftComponent && (
                        <View style={styles.webLeftIcon}>
                            <Ionicons
                                name={icon as any}
                                size={22}
                                color={getIconColor()}
                            />
                        </View>
                    )}

                    {/* Left Component - positioned absolutely */}
                    {leftComponent && (
                        <View style={styles.webLeftComponent}>
                            {leftComponent}
                        </View>
                    )}

                    {/* Right Components - positioned absolutely */}
                    <View style={styles.webRightComponents}>
                        {loading && (
                            <ActivityIndicator
                                size="small"
                                color={colors?.primary || '#d169e5'}
                                style={styles.validationIndicator}
                            />
                        )}

                        {success && !loading && (
                            <Ionicons
                                name="checkmark-circle"
                                size={22}
                                color={colors?.success || '#2E7D32'}
                                style={styles.validationIndicator}
                            />
                        )}

                        {error && !loading && !success && (
                            <Ionicons
                                name="close-circle"
                                size={22}
                                color={colors?.error || '#D32F2F'}
                                style={styles.validationIndicator}
                            />
                        )}

                        {/* Password Toggle */}
                        {secureTextEntry && (
                            <TouchableOpacity
                                style={styles.passwordToggle}
                                onPress={togglePasswordVisibility}
                                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                {...(Platform.OS === 'web' && {
                                    role: 'button',
                                    tabIndex: 0,
                                    onKeyPress: (e: any) => {
                                        if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            togglePasswordVisibility();
                                        }
                                    },
                                } as any)}
                            >
                                <Ionicons
                                    name={showPassword ? "eye-off" : "eye"}
                                    size={22}
                                    color={colors?.secondaryText || '#666666'}
                                />
                            </TouchableOpacity>
                        )}

                        {/* Custom Right Component */}
                        {rightComponent}
                    </View>
                </View>

                {/* Error Message */}
                {error && (
                    <View style={[styles.errorContainer, errorStyle]}>
                        <Ionicons
                            name="alert-circle"
                            size={16}
                            color={colors?.error || '#D32F2F'}
                        />
                        <Text style={[
                            styles.errorText,
                            { color: colors?.error || '#D32F2F' }
                        ]}>
                            {error}
                        </Text>
                    </View>
                )}
            </View>
        );
    }

    // For mobile platforms, use Material Design structure
    return (
        <View style={[styles.container, containerStyle]}>
            <View
                style={[
                    styles.inputWrapper,
                    {
                        borderColor: 'transparent',
                        backgroundColor: getBackgroundColor(),
                        borderWidth: 0,
                        borderBottomWidth: variant === 'filled' ? 2 : (variant === 'outlined' ? 2 : 0),
                    },
                ]}
                onLayout={(e: LayoutChangeEvent) => {
                    setInputWidth(e.nativeEvent.layout.width);
                    setInputHeight(e.nativeEvent.layout.height);
                }}
            >
                {/* Left Icon */}
                {icon && !leftComponent && (
                    <Ionicons
                        name={icon as any}
                        size={22}
                        color={getIconColor()}
                        style={styles.inputIcon}
                    />
                )}

                {/* Left Component */}
                {leftComponent}

                {/* Input Content */}
                <View style={styles.inputContent}>
                    {label && (
                        <>
                            {/* SVG border with a gap for the floating label */}
                            <Svg
                                width={inputWidth}
                                height={inputHeight}
                                style={{ position: 'absolute', top: 0, left: 0, zIndex: 0 }}
                                pointerEvents="none"
                            >
                                {/* Calculate the path for the border with rounded corners and a gap for the label */}
                                <Path
                                    d={(() => {
                                        const y = borderWidth / 2;
                                        const x1 = borderRadius + borderWidth / 2;
                                        const x2 = inputWidth - borderRadius - borderWidth / 2;
                                        const labelGapStart = isLabelFloated ? labelLeft - 4 : x1;
                                        const labelGapEnd = isLabelFloated ? labelLeft + labelWidth + 4 : x2;
                                        // Start at left arc
                                        return `M${x1},${y}` +
                                            ` A${borderRadius},${borderRadius} 0 0 1 ${borderWidth / 2},${y + borderRadius}` +
                                            ` L${borderWidth / 2},${inputHeight - borderRadius - borderWidth / 2}` +
                                            ` A${borderRadius},${borderRadius} 0 0 1 ${x1},${inputHeight - borderWidth / 2}` +
                                            ` L${x2},${inputHeight - borderWidth / 2}` +
                                            ` A${borderRadius},${borderRadius} 0 0 1 ${inputWidth - borderWidth / 2},${inputHeight - borderRadius - borderWidth / 2}` +
                                            ` L${inputWidth - borderWidth / 2},${y + borderRadius}` +
                                            ` A${borderRadius},${borderRadius} 0 0 1 ${x2},${y}` +
                                            ` L${labelGapStart},${y}` +
                                            ` M${labelGapEnd},${y}` +
                                            ` L${x2},${y}`;
                                    })()}
                                    stroke={getBorderColor()}
                                    strokeWidth={borderWidth}
                                    fill="none"
                                />
                            </Svg>
                            {/* Floating label */}
                            <Animated.Text
                                onLayout={e => {
                                    setLabelWidth(e.nativeEvent.layout.width);
                                    setLabelLeft(e.nativeEvent.layout.x);
                                }}
                                style={[
                                    styles.floatingLabel,
                                    {
                                        color: getLabelColor(),
                                        left: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [TEXT_LEFT, FLOAT_LEFT_OFFSET] }),
                                        top: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [20, -14] }),
                                        fontSize: labelAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 12] }),
                                        zIndex: 2,
                                        paddingHorizontal: 4,
                                        backgroundColor: 'transparent',
                                    },
                                    labelStyle
                                ]}
                            >
                                {label}
                            </Animated.Text>
                        </>
                    )}
                    <TextInput
                        ref={ref}
                        style={[
                            styles.input,
                            {
                                color: colors?.text || '#000000',
                                backgroundColor: getBackgroundColor(),
                                paddingLeft: TEXT_LEFT,
                                paddingRight: 60, // Space for right components
                                paddingTop: label ? 24 : 20, // Make room for floated label
                                paddingBottom: 8,
                                borderWidth: 0,
                                borderColor: 'transparent',
                                ...Platform.select({
                                    web: { border: 'none', outline: 'none', boxShadow: 'none' },
                                    default: {},
                                }),
                            },
                            inputStyle
                        ]}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        onChangeText={handleChangeText}
                        secureTextEntry={secureTextEntry && !showPassword}
                        placeholderTextColor="transparent"
                        testID={testID}
                        value={value}
                        {...textInputProps}
                    />
                </View>

                {/* Right Components */}
                <View style={styles.rightComponents}>
                    {loading && (
                        <ActivityIndicator
                            size="small"
                            color={colors?.primary || '#d169e5'}
                            style={styles.validationIndicator}
                        />
                    )}

                    {success && !loading && (
                        <Ionicons
                            name="checkmark-circle"
                            size={22}
                            color={colors?.success || '#2E7D32'}
                            style={styles.validationIndicator}
                        />
                    )}

                    {error && !loading && !success && (
                        <Ionicons
                            name="close-circle"
                            size={22}
                            color={colors?.error || '#D32F2F'}
                            style={styles.validationIndicator}
                        />
                    )}

                    {/* Password Toggle */}
                    {secureTextEntry && (
                        <TouchableOpacity
                            style={styles.passwordToggle}
                            onPress={togglePasswordVisibility}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        >
                            <Ionicons
                                name={showPassword ? "eye-off" : "eye"}
                                size={22}
                                color={colors?.secondaryText || '#666666'}
                            />
                        </TouchableOpacity>
                    )}

                    {/* Custom Right Component */}
                    {rightComponent}
                </View>
            </View>

            {/* Error Message */}
            {error && (
                <View style={[styles.errorContainer, errorStyle]}>
                    <Ionicons
                        name="alert-circle"
                        size={16}
                        color={colors?.error || '#D32F2F'}
                    />
                    <Text style={[
                        styles.errorText,
                        { color: colors?.error || '#D32F2F' }
                    ]}>
                        {error}
                    </Text>
                </View>
            )}
        </View>
    );
});

const createStyles = (colors: any, variant: 'outlined' | 'filled') => StyleSheet.create({
    container: {
        width: '100%',
        marginBottom: 24,
    },
    inputWrapper: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 64,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        paddingHorizontal: 20,
        backgroundColor: variant === 'filled' ? (colors?.inputBackground || '#F5F5F5') : 'transparent',
        position: 'relative',
        borderWidth: 0,
        borderColor: 'transparent',
    },
    inputIcon: {
        marginRight: 12,
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    inputContent: {
        flex: 1,
        justifyContent: 'center',
        position: 'relative',
        height: 64,
    },
    floatingLabel: {
        position: 'absolute',
        fontWeight: '500',
        lineHeight: 24,
        backgroundColor: 'transparent',
        paddingHorizontal: 4,
    },
    input: {
        flex: 1,
        fontSize: 16,
        height: 24,
        paddingVertical: 0,
        marginTop: 8, // Space for floating label
        borderWidth: 0,
        borderColor: 'transparent',
    },
    // Web-specific styles
    webInputContainer: {
        position: 'relative',
        height: 64,
    },
    webInput: {
        width: '100%',
        height: 64,
        fontSize: 16,
        paddingHorizontal: 20,
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderWidth: 0,
        borderColor: 'transparent',
        borderStyle: 'solid',
    },
    webFloatingLabel: {
        position: 'absolute',
        fontWeight: '500',
        lineHeight: 24,
        backgroundColor: 'transparent',
        paddingHorizontal: 4,
    },
    webLeftIcon: {
        position: 'absolute',
        left: 20,
        top: 21, // (64 - 22) / 2
        zIndex: 1,
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    webLeftComponent: {
        position: 'absolute',
        left: 20,
        top: 0,
        height: 64,
        justifyContent: 'center',
        zIndex: 1,
    },
    webRightComponents: {
        position: 'absolute',
        right: 20,
        top: 0,
        height: 64,
        flexDirection: 'row',
        alignItems: 'center',
        zIndex: 1,
    },
    rightComponents: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    validationIndicator: {
        marginLeft: 8,
    },
    passwordToggle: {
        padding: 4,
        marginLeft: 8,
    },
    errorContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderRadius: 12,
        marginTop: 8,
        gap: 8,
        backgroundColor: (colors?.error || '#D32F2F') + '10',
        borderWidth: 1,
        borderColor: (colors?.error || '#D32F2F') + '30',
    },
    errorText: {
        fontSize: 12,
        fontWeight: '500',
        flex: 1,
    },
});

TextField.displayName = 'TextField';

export default TextField; 