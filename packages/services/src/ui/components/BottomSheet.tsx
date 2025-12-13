import React, { forwardRef, useImperativeHandle, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
    View,
    StyleSheet,
    Modal,
    Pressable,
    Dimensions,
    ScrollView,
    Platform,
    type ViewStyle,
    type StyleProp,
} from 'react-native';
import { Gesture, GestureDetector, NativeViewGestureHandler, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useKeyboardHandler } from 'react-native-keyboard-controller';
import Animated, {
    interpolate,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const SPRING_CONFIG = {
    damping: 25,
    stiffness: 300,
    mass: 0.8,
};

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    expand: () => void;
    collapse: () => void;
    scrollTo: (y: number, animated?: boolean) => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    onDismiss?: () => void;
    enablePanDownToClose?: boolean;
    backgroundComponent?: (props: { style?: StyleProp<ViewStyle> }) => React.ReactElement | null;
    backdropComponent?: (props: { style?: StyleProp<ViewStyle>; onPress?: () => void }) => React.ReactElement | null;
    style?: StyleProp<ViewStyle>;
    enableHandlePanningGesture?: boolean;
    onDismissAttempt?: () => boolean;
    detached?: boolean; // If true, shows with margins and rounded corners. If false, full width with rounded top only.
}

const BottomSheet = forwardRef((props: BottomSheetProps, ref: React.ForwardedRef<BottomSheetRef>) => {
    const {
        children,
        onDismiss,
        enablePanDownToClose = true,
        backgroundComponent,
        backdropComponent,
        style,
        enableHandlePanningGesture = true,
        onDismissAttempt,
        detached = false,
    } = props;

    const insets = useSafeAreaInsets();
    const colorScheme = useColorScheme();
    const colors = Colors[colorScheme ?? 'light'];
    const [visible, setVisible] = useState(false);
    const scrollViewRef = useRef<ScrollView>(null);
    const nativeGestureRef = useRef<NativeViewGestureHandler>(null);

    const translateY = useSharedValue(SCREEN_HEIGHT);
    const opacity = useSharedValue(0);
    const keyboardHeight = useSharedValue(0);
    const context = useSharedValue({ y: 0 });

    useKeyboardHandler({
        onMove: (e) => {
            'worklet';
            keyboardHeight.value = e.height;
        },
        onEnd: (e) => {
            'worklet';
            keyboardHeight.value = e.height;
        },
    }, []);

    useEffect(() => {
        if (visible) {
            opacity.value = withTiming(1, { duration: 250 });
            translateY.value = withSpring(0, SPRING_CONFIG);
        } else {
            opacity.value = withTiming(0, { duration: 200 });
            translateY.value = withSpring(SCREEN_HEIGHT, { ...SPRING_CONFIG, stiffness: 250 });
        }
    }, [visible]);

    // Apply web scrollbar styles when colors change
    useEffect(() => {
        if (Platform.OS === 'web') {
            createWebScrollbarStyle(colors.border);
        }
    }, [colors.border]);

    const safeClose = () => {
        if (onDismissAttempt?.()) {
            onDismiss?.();
        } else if (!onDismissAttempt) {
            onDismiss?.();
        }
    };

    const present = useCallback(() => setVisible(true), []);
    const dismiss = useCallback(() => {
        setVisible(false);
        safeClose();
    }, [safeClose]);

    const scrollTo = useCallback((y: number, animated = true) => {
        scrollViewRef.current?.scrollTo({ y, animated });
    }, []);

    useImperativeHandle(ref, () => ({
        present,
        dismiss,
        close: dismiss,
        expand: present,
        collapse: dismiss,
        scrollTo,
    }), [present, dismiss, scrollTo]);

    const panGesture = Gesture.Pan()
        .enabled(enablePanDownToClose)
        .simultaneousWithExternalGesture(nativeGestureRef as any)
        .onStart(() => {
            'worklet';
            context.value = { y: translateY.value };
        })
        .onUpdate((event) => {
            'worklet';
            const newTranslateY = context.value.y + event.translationY;
            if (newTranslateY >= 0) {
                translateY.value = newTranslateY;
            } else if (detached) {
                // Only allow overdrag (pulling up beyond top) when detached
                translateY.value = newTranslateY * 0.3;
            } else {
                // In normal mode, prevent overdrag - clamp to 0
                translateY.value = 0;
            }
        })
        .onEnd((event) => {
            'worklet';
            const velocity = event.velocityY;
            const shouldClose = velocity > 500 || (translateY.value > 100 && velocity > -200);

            if (shouldClose) {
                translateY.value = withSpring(SCREEN_HEIGHT, {
                    ...SPRING_CONFIG,
                    velocity: velocity,
                });
                opacity.value = withTiming(0, { duration: 200 });
                runOnJS(safeClose)();
            } else {
                translateY.value = withSpring(0, {
                    ...SPRING_CONFIG,
                    velocity: velocity,
                });
            }
        });

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    const sheetStyle = useAnimatedStyle(() => {
        const scale = interpolate(translateY.value, [0, SCREEN_HEIGHT], [1, 0.95]);
        return {
            transform: [
                { translateY: translateY.value - keyboardHeight.value },
                { scale },
            ],
        };
    });

    const sheetHeightStyle = useAnimatedStyle(() => ({
        maxHeight: SCREEN_HEIGHT - keyboardHeight.value - insets.top - (detached ? insets.bottom + 16 : 0),
    }), [insets.top, insets.bottom, detached]);

    const sheetMarginStyle = useAnimatedStyle(() => {
        // Only add margin when detached, otherwise extend behind safe area
        if (detached) {
            return {
                marginBottom: keyboardHeight.value > 0 ? 16 : insets.bottom + 16,
            };
        }
        return {
            marginBottom: 0,
        };
    }, [insets.bottom, detached]);

    const handleBackdropPress = useCallback(() => {
        if (enablePanDownToClose) {
            if (onDismissAttempt?.()) {
                dismiss();
            } else if (!onDismissAttempt) {
                dismiss();
            }
        }
    }, [enablePanDownToClose, onDismissAttempt, dismiss]);

    const dynamicStyles = useMemo(() => StyleSheet.create({
        handle: {
            ...styles.handle,
            backgroundColor: colorScheme === 'dark' ? '#444' : '#C7C7CC',
        },
        sheet: {
            ...styles.sheet,
            backgroundColor: colors.background,
            ...(detached ? styles.sheetDetached : styles.sheetNormal),
        },
        scrollContent: {
            ...styles.scrollContent,
            // In normal mode, don't add padding here - screens handle their own padding
            // The sheet extends behind safe area, and screens add padding as needed
        },
    }), [colorScheme, colors.background, detached, insets.bottom]);

    if (!visible) return null;

    return (
        <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
            <GestureHandlerRootView style={StyleSheet.absoluteFill}>
                <Animated.View style={[styles.backdrop, backdropStyle]}>
                    {backdropComponent ? (
                        backdropComponent({ onPress: handleBackdropPress })
                    ) : (
                        <Pressable style={styles.backdropTouchable} onPress={handleBackdropPress}>
                            <View style={StyleSheet.absoluteFill} />
                        </Pressable>
                    )}
                </Animated.View>

                <GestureDetector gesture={panGesture}>
                    <Animated.View style={[dynamicStyles.sheet, sheetMarginStyle, sheetStyle, sheetHeightStyle]}>
                        {backgroundComponent?.({ style: styles.background })}

                        <View style={dynamicStyles.handle} />

                        <NativeViewGestureHandler ref={nativeGestureRef}>
                            <ScrollView
                                ref={scrollViewRef}
                                style={[
                                    styles.scrollView,
                                    Platform.OS === 'web' && {
                                        scrollbarWidth: 'thin' as const,
                                        scrollbarColor: `${colors.border} transparent`,
                                    } as any,
                                ]}
                                contentContainerStyle={dynamicStyles.scrollContent}
                                showsVerticalScrollIndicator={false}
                                keyboardShouldPersistTaps="handled"
                                // @ts-ignore - Web className
                                className={Platform.OS === 'web' ? 'bottom-sheet-scrollview' : undefined}
                                onLayout={() => {
                                    if (Platform.OS === 'web') {
                                        createWebScrollbarStyle(colors.border);
                                    }
                                }}
                            >
                                {children}
                            </ScrollView>
                        </NativeViewGestureHandler>
                    </Animated.View>
                </GestureDetector>
            </GestureHandlerRootView>
        </Modal>
    );
});

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    backdropTouchable: {
        flex: 1,
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        overflow: 'hidden',
        maxWidth: 800,
        alignSelf: 'center',
        marginHorizontal: 'auto',
    },
    sheetDetached: {
        left: 16,
        right: 16,
        borderRadius: 24,
    },
    sheetNormal: {
        left: 0,
        right: 0,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
    },
    handle: {
        position: 'absolute',
        top: 10,
        left: '50%',
        marginLeft: -18,
        width: 36,
        height: 5,
        borderRadius: 3,
        zIndex: 100,
    },
    background: {
        ...StyleSheet.absoluteFillObject,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
});

// Create web scrollbar styles dynamically based on theme
const createWebScrollbarStyle = (borderColor: string) => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const styleId = 'bottom-sheet-scrollbar-style';
    let styleElement = document.getElementById(styleId) as HTMLStyleElement;

    if (!styleElement) {
        styleElement = document.createElement('style');
        styleElement.id = styleId;
        document.head.appendChild(styleElement);
    }

    // Use theme border color for scrollbar
    const scrollbarColor = borderColor;
    const scrollbarHoverColor = borderColor === '#E5E5EA' ? '#C7C7CC' : '#555';

    styleElement.textContent = `
        .bottom-sheet-scrollview::-webkit-scrollbar {
            width: 6px;
        }
        .bottom-sheet-scrollview::-webkit-scrollbar-track {
            background: transparent;
            border-radius: 10px;
        }
        .bottom-sheet-scrollview::-webkit-scrollbar-thumb {
            background: ${scrollbarColor};
            border-radius: 10px;
        }
        .bottom-sheet-scrollview::-webkit-scrollbar-thumb:hover {
            background: ${scrollbarHoverColor};
        }
    `;
};

export default BottomSheet;