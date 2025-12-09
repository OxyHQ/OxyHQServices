import React, { forwardRef, useImperativeHandle, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
    View,
    StyleSheet,
    Modal,
    TouchableWithoutFeedback,
    Dimensions,
    Platform,
    type ViewStyle,
    type StyleProp,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView, NativeViewGestureHandler } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS,
    useAnimatedScrollHandler,
    useAnimatedRef,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const ANIMATION_CONFIG = {
    spring: {
        damping: 30,
        stiffness: 300,
        mass: 0.8,
    },
    timing: {
        duration: 250,
    },
} as const;

const GESTURE_CONFIG = {
    dismissThreshold: 100,
    dismissVelocity: 500,
    opacityThreshold: 200,
    activeOffsetY: 10,
    failOffsetX: 20,
} as const;

const HIDDEN_BOTTOM = -SCREEN_HEIGHT;
const VISIBLE_BOTTOM = 0;
const BACKDROP_OPACITY = 0.5;
const KEYBOARD_GAP = 40;

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    expand: () => void;
    collapse: () => void;
    updateKeyboardPadding: (height: number) => void;
    scrollTo: (y: number, animated?: boolean) => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    onDismiss?: () => void;
    enablePanDownToClose?: boolean;
    backgroundComponent?: (props: { style?: StyleProp<ViewStyle> }) => React.ReactElement | null;
    backdropComponent?: (props: {
        style?: StyleProp<ViewStyle>;
        onPress?: () => void;
    }) => React.ReactElement | null;
    handleStyle?: StyleProp<ViewStyle>;
    handleIndicatorStyle?: StyleProp<ViewStyle>;
    style?: StyleProp<ViewStyle>;
    enableHandlePanningGesture?: boolean;
    onDismissAttempt?: () => boolean;
    useScrollView?: boolean;
}

const BottomSheet = forwardRef((props: BottomSheetProps, ref: React.ForwardedRef<BottomSheetRef>) => {
    const {
        children,
        onDismiss,
        enablePanDownToClose = true,
        backgroundComponent,
        backdropComponent,
        handleStyle,
        handleIndicatorStyle,
        style,
        enableHandlePanningGesture = true,
        onDismissAttempt,
        useScrollView = true,
    } = props;

    const insets = useSafeAreaInsets();
    const [isVisible, setIsVisible] = useState(false);
    const [contentHeight, setContentHeight] = useState(0);

    const nativeGestureRef = useRef<NativeViewGestureHandler>(null);
    const scrollRef = useAnimatedRef<Animated.ScrollView>();
    const scrollY = useSharedValue(0);

    const bottom = useSharedValue(HIDDEN_BOTTOM);
    const backdropOpacity = useSharedValue(0);
    const isAnimating = useSharedValue(false);
    const isMountedRef = useRef(true);
    const paddingBottom = useSharedValue(0);

    const animateToPosition = useCallback(
        (targetBottom: number, opacity: number) => {
            bottom.value = withSpring(targetBottom, ANIMATION_CONFIG.spring);
            backdropOpacity.value = withTiming(opacity, ANIMATION_CONFIG.timing);
        },
        [bottom, backdropOpacity],
    );

    const present = useCallback(() => {
        setIsVisible(true);
    }, []);

    const handleDismissComplete = useCallback(() => {
        if (!isMountedRef.current) return;
        setIsVisible(false);
        isAnimating.value = false;
        setTimeout(() => {
            if (isMountedRef.current) {
                onDismiss?.();
            }
        }, 0);
    }, [onDismiss, isAnimating]);

    const dismiss = useCallback(() => {
        if (isAnimating.value || !isVisible || !isMountedRef.current) return;

        isAnimating.value = true;
        backdropOpacity.value = withTiming(0, ANIMATION_CONFIG.timing);
        bottom.value = withSpring(HIDDEN_BOTTOM, ANIMATION_CONFIG.spring, () => {
            runOnJS(handleDismissComplete)();
        });
    }, [isVisible, bottom, backdropOpacity, isAnimating, handleDismissComplete]);

    const calculatePadding = useCallback((height: number) => {
        return height > 0
            ? insets.bottom + height + KEYBOARD_GAP
            : insets.bottom;
    }, [insets.bottom]);

    const updateKeyboardPadding = useCallback((height: number) => {
        if (!isVisible) {
            paddingBottom.value = 0;
            return;
        }
        paddingBottom.value = calculatePadding(height);
    }, [isVisible, calculatePadding, paddingBottom]);

    const scrollTo = useCallback((y: number, animated = true) => {
        if (scrollRef.current) {
            scrollRef.current.scrollTo({ y, animated });
        }
    }, [scrollRef]);

    useImperativeHandle(
        ref,
        () => ({
            present,
            dismiss,
            close: dismiss,
            expand: present,
            collapse: dismiss,
            updateKeyboardPadding,
            scrollTo,
        }),
        [present, dismiss, updateKeyboardPadding, scrollTo],
    );

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    useEffect(() => {
        if (isVisible) {
            bottom.value = HIDDEN_BOTTOM;
            backdropOpacity.value = 0;
            requestAnimationFrame(() => {
                if (isMountedRef.current) {
                    animateToPosition(VISIBLE_BOTTOM, BACKDROP_OPACITY);
                }
            });
        } else {
            bottom.value = HIDDEN_BOTTOM;
            backdropOpacity.value = 0;
            paddingBottom.value = 0;
        }
    }, [isVisible, animateToPosition, bottom, backdropOpacity, paddingBottom]);

    const attemptDismiss = useCallback(() => {
        if (onDismissAttempt) {
            const canDismiss = onDismissAttempt();
            if (canDismiss) {
                dismiss();
            } else {
                bottom.value = withSpring(VISIBLE_BOTTOM, ANIMATION_CONFIG.spring);
                backdropOpacity.value = withTiming(BACKDROP_OPACITY, ANIMATION_CONFIG.timing);
            }
        } else {
            dismiss();
        }
    }, [onDismissAttempt, dismiss, bottom, backdropOpacity]);

    const handleDismissAttempt = useCallback(() => {
        if (onDismissAttempt) {
            const canDismiss = onDismissAttempt();
            return canDismiss;
        }
        return true;
    }, [onDismissAttempt]);

    const handlePanGesture = useMemo(
        () =>
            Gesture.Pan()
                .enabled(enablePanDownToClose && enableHandlePanningGesture)
                .activeOffsetY(GESTURE_CONFIG.activeOffsetY)
                .failOffsetX([-GESTURE_CONFIG.failOffsetX, GESTURE_CONFIG.failOffsetX])
                .onUpdate((event) => {
                    'worklet';
                    if (event.translationY > 0) {
                        bottom.value = VISIBLE_BOTTOM - event.translationY;
                        const progress = Math.min(event.translationY / GESTURE_CONFIG.opacityThreshold, 1);
                        backdropOpacity.value = BACKDROP_OPACITY * (1 - progress);
                    }
                })
                .onEnd((event) => {
                    'worklet';
                    const shouldDismiss =
                        event.translationY > GESTURE_CONFIG.dismissThreshold ||
                        event.velocityY > GESTURE_CONFIG.dismissVelocity;

                    if (shouldDismiss) {
                        runOnJS(attemptDismiss)();
                    } else {
                        bottom.value = withSpring(VISIBLE_BOTTOM, ANIMATION_CONFIG.spring);
                        backdropOpacity.value = withTiming(BACKDROP_OPACITY, ANIMATION_CONFIG.timing);
                    }
                }),
        [enablePanDownToClose, enableHandlePanningGesture, bottom, backdropOpacity, attemptDismiss],
    );

    const contentPanGesture = useMemo(
        () =>
            Gesture.Pan()
                .enabled(enablePanDownToClose && useScrollView)
                .activeOffsetY(GESTURE_CONFIG.activeOffsetY)
                .failOffsetX([-GESTURE_CONFIG.failOffsetX, GESTURE_CONFIG.failOffsetX])
                .simultaneousWithExternalGesture(nativeGestureRef as any)
                .onUpdate((event) => {
                    'worklet';
                    if (scrollY.value <= 0 && event.translationY > 0) {
                        bottom.value = VISIBLE_BOTTOM - event.translationY;
                        const progress = Math.min(event.translationY / GESTURE_CONFIG.opacityThreshold, 1);
                        backdropOpacity.value = BACKDROP_OPACITY * (1 - progress);
                    }
                })
                .onEnd((event) => {
                    'worklet';
                    if (scrollY.value > 0) return;

                    const shouldDismiss =
                        event.translationY > GESTURE_CONFIG.dismissThreshold ||
                        event.velocityY > GESTURE_CONFIG.dismissVelocity;

                    if (shouldDismiss && event.translationY > 0) {
                        runOnJS(attemptDismiss)();
                    } else {
                        bottom.value = withSpring(VISIBLE_BOTTOM, ANIMATION_CONFIG.spring);
                        backdropOpacity.value = withTiming(BACKDROP_OPACITY, ANIMATION_CONFIG.timing);
                    }
                }),
        [enablePanDownToClose, bottom, backdropOpacity, attemptDismiss, scrollY, useScrollView],
    );

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollY.value = event.contentOffset.y;
        },
    });

    const sheetContainerMaxHeight = useMemo(() => {
        const percentCap = SCREEN_HEIGHT * 0.9;
        const safeAreaCap = SCREEN_HEIGHT - insets.top - insets.bottom;
        return Math.min(percentCap, safeAreaCap);
    }, [insets.top, insets.bottom]);

    const scrollContentPadding = useMemo(() => {
        const handleHeight = enableHandlePanningGesture ? 20 : 0;
        return {
            paddingTop: handleHeight,
            flexGrow: 1,
        };
    }, [enableHandlePanningGesture]);

    const sheetContainerStyle = useMemo(
        () => [
            styles.sheetContainer,
            {
                maxHeight: sheetContainerMaxHeight,
                flexShrink: 1,
            },
        ],
        [sheetContainerMaxHeight],
    );

    const sheetAnimatedStyle = useAnimatedStyle(
        () => ({
            bottom: bottom.value,
        }),
        [],
    );

    const paddingAnimatedStyle = useAnimatedStyle(
        () => ({
            paddingBottom: paddingBottom.value,
        }),
        [],
    );

    const backdropAnimatedStyle = useAnimatedStyle(
        () => ({
            opacity: backdropOpacity.value,
        }),
        [],
    );

    const handleBackdropPress = useCallback(() => {
        if (enablePanDownToClose) {
            const canDismiss = handleDismissAttempt();
            if (canDismiss) {
                dismiss();
            }
        }
    }, [enablePanDownToClose, dismiss, handleDismissAttempt]);

    const renderBackdrop = useCallback(
        (props: { style?: StyleProp<ViewStyle>; onPress?: () => void }) => {
            if (backdropComponent) {
                return backdropComponent(props);
            }
            return (
                <TouchableWithoutFeedback onPress={props.onPress}>
                    <Animated.View style={[styles.backdrop, props.style]} />
                </TouchableWithoutFeedback>
            );
        },
        [backdropComponent],
    );

    const renderBackground = useCallback(
        (props: { style?: StyleProp<ViewStyle> }) => {
            if (backgroundComponent) {
                return backgroundComponent(props);
            }
            return <View style={[styles.background, props.style]} />;
        },
        [backgroundComponent],
    );

    if (!isVisible) {
        return null;
    }

    return (
        <Modal
            visible={isVisible}
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={attemptDismiss}
        >
            <GestureHandlerRootView style={{ flex: 1 }}>
                <View style={styles.modalContainer}>
                    <Animated.View style={[styles.backdropContainer, backdropAnimatedStyle]}>
                        {renderBackdrop({ onPress: handleBackdropPress })}
                    </Animated.View>

                    <Animated.View
                        style={[
                            sheetContainerStyle,
                            sheetAnimatedStyle,
                            style,
                        ]}
                    >
                        <Animated.View style={[styles.backgroundContainer, paddingAnimatedStyle]}>
                            {renderBackground({ style: styles.backgroundInner })}
                            {enableHandlePanningGesture && (
                                <GestureDetector gesture={handlePanGesture}>
                                    <Animated.View style={[styles.handleContainer, handleStyle]}>
                                        <View style={[styles.handleIndicator, handleIndicatorStyle]} />
                                    </Animated.View>
                                </GestureDetector>
                            )}
                            {useScrollView ? (
                                <GestureDetector gesture={contentPanGesture}>
                                    <NativeViewGestureHandler ref={nativeGestureRef}>
                                        <Animated.ScrollView
                                            ref={scrollRef}
                                            style={[
                                                styles.scrollView,
                                                { height: contentHeight > 0 ? contentHeight : undefined }
                                            ]}
                                            contentContainerStyle={[
                                                styles.scrollContent,
                                                scrollContentPadding,
                                                // Removed minHeight: '100%' to avoid forced overflow
                                            ]}
                                            keyboardShouldPersistTaps="handled"
                                            showsVerticalScrollIndicator={contentHeight > sheetContainerMaxHeight}
                                            bounces={true}
                                            onScroll={scrollHandler}
                                            scrollEventThrottle={16}
                                            onContentSizeChange={(_, h) => setContentHeight(h)}
                                            nestedScrollEnabled={true}
                                        >
                                            {children}
                                        </Animated.ScrollView>
                                    </NativeViewGestureHandler>
                                </GestureDetector>
                            ) : (
                                <Animated.View
                                    style={[
                                        styles.scrollView,
                                        scrollContentPadding,
                                        { flexShrink: 1, overflow: 'hidden' }
                                    ]}
                                >
                                    {children}
                                </Animated.View>
                            )}
                        </Animated.View>
                    </Animated.View>
                </View>
            </GestureHandlerRootView>
        </Modal>
    );
});

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    modalContainer: {
        flex: 1,
    },
    backdropContainer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
    backdrop: {
        flex: 1,
        backgroundColor: '#000',
    },
    sheetContainer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        maxWidth: 800,
        width: '100%',
        alignSelf: 'center',
        flexShrink: 1,
        zIndex: 2,
    },
    backgroundContainer: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
        position: 'relative',
        flexShrink: 1,
        minHeight: 0,
    },
    backgroundInner: {
        ...StyleSheet.absoluteFillObject,
    },
    background: {
        backgroundColor: '#fff',
    },
    handleContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 20,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
        backgroundColor: '#ccc',
        marginTop: 8,
    },
    content: {
        width: '100%',
    },
    scrollView: {
        flexShrink: 1,
        minHeight: 0,
    },
    scrollContent: {
        flexGrow: 1,
    },
});

export default BottomSheet;
