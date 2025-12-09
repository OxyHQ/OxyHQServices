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
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    withTiming,
    runOnJS,
    useAnimatedScrollHandler,
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
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
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
        },
        ref,
    ) => {
        const insets = useSafeAreaInsets();
        const [isVisible, setIsVisible] = useState(false);
        const scrollViewRef = useRef<Animated.ScrollView>(null);
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
            // Always include safe area bottom, add keyboard gap if keyboard is visible
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

        useImperativeHandle(
            ref,
            () => ({
                present,
                dismiss,
                close: dismiss,
                expand: present,
                collapse: dismiss,
                updateKeyboardPadding,
            }),
            [present, dismiss, updateKeyboardPadding],
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
                    // Reset position if dismissal was prevented
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

        const panGesture = useMemo(
            () =>
                Gesture.Pan()
                    .enabled(enablePanDownToClose)
                    .activeOffsetY(GESTURE_CONFIG.activeOffsetY)
                    .failOffsetX([-GESTURE_CONFIG.failOffsetX, GESTURE_CONFIG.failOffsetX])
                    .onTouchesDown((_event, state) => {
                        'worklet';
                        // Fail gesture immediately if scroll is not at top - allows ScrollView to handle it
                        if (scrollY.value > 0) {
                            state.fail();
                        }
                    })
                    .onUpdate((event) => {
                        'worklet';
                        // Only allow pan gesture when scroll is at top (scrollY === 0)
                        if (event.translationY > 0 && scrollY.value === 0) {
                            bottom.value = VISIBLE_BOTTOM - event.translationY;
                            const progress = Math.min(event.translationY / GESTURE_CONFIG.opacityThreshold, 1);
                            backdropOpacity.value = BACKDROP_OPACITY * (1 - progress);
                        }
                    })
                    .onEnd((event) => {
                        'worklet';
                        // Only process dismiss if scroll is at top
                        if (scrollY.value === 0) {
                            const shouldDismiss =
                                event.translationY > GESTURE_CONFIG.dismissThreshold ||
                                event.velocityY > GESTURE_CONFIG.dismissVelocity;

                            if (shouldDismiss) {
                                runOnJS(attemptDismiss)();
                            } else {
                                bottom.value = withSpring(VISIBLE_BOTTOM, ANIMATION_CONFIG.spring);
                                backdropOpacity.value = withTiming(BACKDROP_OPACITY, ANIMATION_CONFIG.timing);
                            }
                        } else {
                            // Reset position if scroll is not at top
                            bottom.value = withSpring(VISIBLE_BOTTOM, ANIMATION_CONFIG.spring);
                            backdropOpacity.value = withTiming(BACKDROP_OPACITY, ANIMATION_CONFIG.timing);
                        }
                    }),
            [enablePanDownToClose, bottom, backdropOpacity, attemptDismiss, scrollY],
        );

        const scrollHandler = useAnimatedScrollHandler({
            onScroll: (event) => {
                scrollY.value = event.contentOffset.y;
            },
        });

        // Calculate max height for sheet container (90% of screen minus safe area top)
        const sheetContainerMaxHeight = useMemo(() => {
            const maxHeightPercent = 0.9;
            return SCREEN_HEIGHT * maxHeightPercent - insets.top;
        }, [insets.top]);

        // Calculate ScrollView content padding
        const scrollContentPadding = useMemo(() => {
            const handleHeight = enableHandlePanningGesture ? 20 : 0;
            const paddingTop = handleHeight + insets.top;
            // paddingBottom will be handled by animated style (keyboard + safe area)
            return {
                paddingTop,
            };
        }, [enableHandlePanningGesture, insets.top]);

        // Memoized style for sheet container with calculated max height
        const sheetContainerStyle = useMemo(() => [
            styles.sheetContainer,
            { maxHeight: sheetContainerMaxHeight, height: sheetContainerMaxHeight },
        ], [sheetContainerMaxHeight]);

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
                // If canDismiss is false, do nothing (backdrop press is disabled)
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
                onRequestClose={dismiss}
            >
                <GestureHandlerRootView style={styles.modalContainer}>
                    <Animated.View style={[styles.backdropContainer, backdropAnimatedStyle]}>
                        {renderBackdrop({ onPress: handleBackdropPress })}
                    </Animated.View>

                    <GestureDetector gesture={panGesture}>
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
                                    <View style={[styles.handleContainer, handleStyle]}>
                                        <View style={[styles.handleIndicator, handleIndicatorStyle]} />
                                    </View>
                                )}
                                <Animated.ScrollView
                                    ref={scrollViewRef}
                                    style={styles.scrollView}
                                    contentContainerStyle={[
                                        styles.scrollContent,
                                        scrollContentPadding,
                                    ]}
                                    keyboardShouldPersistTaps="handled"
                                    showsVerticalScrollIndicator={true}
                                    bounces={true}
                                    onScroll={scrollHandler}
                                    scrollEventThrottle={16}
                                    nestedScrollEnabled={Platform.OS === 'android'}
                                >
                                    {children}
                                </Animated.ScrollView>
                            </Animated.View>
                        </Animated.View>
                    </GestureDetector>
                </GestureHandlerRootView>
            </Modal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    modalContainer: {
        flex: 1,
    },
    backdropContainer: {
        ...StyleSheet.absoluteFillObject,
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
        // maxHeight will be set dynamically based on screen height and safe areas
    },
    backgroundContainer: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
        position: 'relative',
        flex: 1,
        height: '100%',
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
        flex: 1,
    },
    scrollContent: {
        // Remove flexGrow to prevent content from expanding beyond container
        // Content will scroll when it exceeds available space
    },
});

export default BottomSheet;
