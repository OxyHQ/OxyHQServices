import type React from 'react';
import { forwardRef, useImperativeHandle, useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
    View,
    StyleSheet,
    Modal,
    Pressable,
    Dimensions,
    Platform,
    type ViewStyle,
    type StyleProp,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    interpolate,
    runOnJS,
    useAnimatedScrollHandler,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@oxyhq/bloom/theme';

// Keyboard handler — only on native platforms. On web, keyboard events are handled by the browser.
const noopKeyboardHandler = (_handlers: Record<string, (e: { height: number }) => void>, _deps: unknown[]) => {};
let useKeyboardHandler: (handlers: Record<string, (e: { height: number }) => void>, deps: unknown[]) => void = noopKeyboardHandler;
if (Platform.OS !== 'web') {
    try {
        useKeyboardHandler = require('react-native-keyboard-controller').useKeyboardHandler;
    } catch {
        // Keyboard controller not available
    }
}

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
    /**
     * When `true` (default), children are wrapped in an internal scrollable
     * container — convenient for vertical content that can overflow.
     *
     * Set to `false` when the screen owns its own scrolling primitive
     * (e.g. a `FlatList`, `SectionList`, or any other VirtualizedList).
     * Nesting a VirtualizedList inside the internal ScrollView would break
     * windowing/keyboard handling and trigger a React Native warning. In
     * non-scrollable mode the screen receives the full available height
     * (minus the drag handle) and must manage its own overflow.
     */
    scrollable?: boolean;
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
        scrollable = true,
    } = props;

    const insets = useSafeAreaInsets();
    const theme = useTheme();
    const [visible, setVisible] = useState(false);
    const [rendered, setRendered] = useState(false); // keep mounted for exit animation
    const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasClosedRef = useRef(false);
    const scrollViewRef = useRef<Animated.ScrollView>(null);

    const translateY = useSharedValue(SCREEN_HEIGHT);
    const opacity = useSharedValue(0);
    const scrollOffsetY = useSharedValue(0);
    const isScrollAtTop = useSharedValue(true);
    const allowPanClose = useSharedValue(true);
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

    // Dismiss callbacks
    const safeClose = useCallback(() => {
        if (onDismissAttempt?.()) {
            onDismiss?.();
        } else if (!onDismissAttempt) {
            onDismiss?.();
        }
    }, [onDismiss, onDismissAttempt]);

    const finishClose = useCallback(() => {
        if (hasClosedRef.current) return;
        hasClosedRef.current = true;
        safeClose();
        setRendered(false);
    }, [safeClose]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: opacity and translateY are Reanimated SharedValues (stable refs) that should not be listed as dependencies
    useEffect(() => {
        if (visible) {
            if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
                closeTimeoutRef.current = null;
            }
            hasClosedRef.current = false;
            opacity.value = withTiming(1, { duration: 250 });
            translateY.value = withSpring(0, SPRING_CONFIG);
        } else if (rendered) {
            opacity.value = withTiming(0, { duration: 250 }, (finished) => {
                if (finished) {
                    runOnJS(finishClose)();
                }
            });
            translateY.value = withSpring(SCREEN_HEIGHT, { ...SPRING_CONFIG, stiffness: 250 });

            // Fallback timer to ensure close completes (especially on web)
            if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
            }
            closeTimeoutRef.current = setTimeout(() => {
                finishClose();
                closeTimeoutRef.current = null;
            }, 300);
        }
    }, [visible, rendered, finishClose]);

    // Clear pending timeout on unmount
    useEffect(() => () => {
        if (closeTimeoutRef.current) {
            clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = null;
        }
    }, []);

    // Apply web scrollbar styles when colors change
    useEffect(() => {
        if (Platform.OS === 'web') {
            createWebScrollbarStyle(theme.colors.border);
        }
    }, [theme.colors.border]);

    const present = useCallback(() => {
        setRendered(true);
        setVisible(true);
    }, []);
    const dismiss = useCallback(() => {
        setVisible(false);
    }, []);

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

    // iOS-style sheet model: the handle is the ONLY surface that drags the
    // sheet. The inner ScrollView gets full ownership of vertical touches in
    // the content area, so scroll and drag never fight each other (which was
    // breaking scroll on Android — the outer pan was claiming touches even
    // when allowPanClose=false in onStart).
    //
    // Dedicated pan for the handle — unconditional, always drags.
    const handlePanGesture = useMemo(
        () =>
            Gesture.Pan()
                .enabled(enablePanDownToClose && enableHandlePanningGesture)
                .activeOffsetY([-8, 8])
                .onStart(() => {
                    'worklet';
                    context.value = { y: translateY.value };
                    // Handle drags ALWAYS get to move the sheet.
                    allowPanClose.value = true;
                })
                .onUpdate((event) => {
                    'worklet';
                    const newTranslateY = context.value.y + event.translationY;
                    if (newTranslateY >= 0) {
                        translateY.value = newTranslateY;
                    } else if (detached) {
                        translateY.value = newTranslateY * 0.3;
                    } else {
                        translateY.value = 0;
                    }
                })
                .onEnd((event) => {
                    'worklet';
                    const velocity = event.velocityY;
                    const distance = translateY.value;
                    const closeThreshold = Math.max(140, SCREEN_HEIGHT * 0.25);
                    const fastSwipeThreshold = 900;
                    const shouldClose =
                        velocity > fastSwipeThreshold ||
                        (distance > closeThreshold && velocity > -300);

                    if (shouldClose) {
                        translateY.value = withSpring(SCREEN_HEIGHT, {
                            ...SPRING_CONFIG,
                            velocity: velocity,
                        });
                        opacity.value = withTiming(0, { duration: 250 }, (finished) => {
                            if (finished) {
                                runOnJS(finishClose)();
                            }
                        });
                    } else {
                        translateY.value = withSpring(0, {
                            ...SPRING_CONFIG,
                            velocity: velocity,
                        });
                    }
                }),
        [
            allowPanClose,
            context,
            detached,
            enableHandlePanningGesture,
            enablePanDownToClose,
            finishClose,
            opacity,
            translateY,
        ],
    );

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
        // Always animate close on backdrop press
        if (onDismissAttempt && !onDismissAttempt()) {
            return;
        }
        dismiss();
    }, [onDismissAttempt, dismiss]);

    const scrollHandler = useAnimatedScrollHandler({
        onScroll: (event) => {
            scrollOffsetY.value = event.contentOffset.y;
            isScrollAtTop.value = event.contentOffset.y <= 0;
        },
    });

    const dynamicStyles = useMemo(() => {
        return StyleSheet.create({
            handle: {
                ...styles.handle,
                backgroundColor: theme.isDark ? theme.colors.border : theme.colors.borderLight,
            },
            sheet: {
                ...styles.sheet,
                ...(detached ? styles.sheetDetached : styles.sheetNormal),
                backgroundColor: theme.colors.background,
            },
            scrollContent: {
                ...styles.scrollContent,
                // In normal mode, don't add padding here - screens handle their own padding
                // The sheet extends behind safe area, and screens add padding as needed
            },
        });
    }, [theme.colors.background, theme.colors.border, theme.colors.borderLight, theme.isDark, detached]);

    if (!rendered) return null;

    return (
        <Modal visible={rendered} transparent animationType="none" statusBarTranslucent onRequestClose={dismiss}>
            {/*
             * On native, RN's <Modal> renders into its own window — the
             * GestureHandlerRootView at the app root does NOT extend into
             * the Modal's view hierarchy, so every gesture inside it would
             * die silently. Re-mounting a GestureHandlerRootView at the
             * Modal root scopes gesture-handler correctly to the sheet's
             * subtree. (Web renders Modal inline, so it's a no-op there.)
             * See: https://docs.swmansion.com/react-native-gesture-handler/docs/installation
             */}
            <GestureHandlerRootView style={StyleSheet.absoluteFill}>
                <Animated.View style={[styles.backdrop, { backgroundColor: theme.colors.overlay }, backdropStyle]}>
                    {backdropComponent ? (
                        backdropComponent({ onPress: handleBackdropPress })
                    ) : (
                        <Pressable style={styles.backdropTouchable} onPress={handleBackdropPress}>
                            <View style={StyleSheet.absoluteFill} />
                        </Pressable>
                    )}
                </Animated.View>

                <Animated.View style={[dynamicStyles.sheet, sheetMarginStyle, sheetStyle, sheetHeightStyle]}>
                        {backgroundComponent?.({ style: styles.background })}

                        {/*
                         * Handle area — the DEDICATED drag surface. iOS-style:
                         * the handle is the only place the sheet can be dragged
                         * to dismiss, so the inner ScrollView keeps full control
                         * of vertical scroll without fighting an outer pan
                         * gesture. We size the touch target generously (full
                         * sheet width, 28dp tall) so it's easy to grab on phones.
                         */}
                        <GestureDetector gesture={handlePanGesture}>
                            <View style={styles.handleHitArea} accessible accessibilityRole="adjustable">
                                <View style={dynamicStyles.handle} />
                            </View>
                        </GestureDetector>

                        {scrollable ? (
                            <Animated.ScrollView
                                    ref={scrollViewRef}
                                    style={[
                                        styles.scrollView,
                                        Platform.OS === 'web' && ({
                                            scrollbarWidth: 'thin',
                                            scrollbarColor: `${theme.colors.border} transparent`,
                                        } as ViewStyle),
                                    ]}
                                    contentContainerStyle={dynamicStyles.scrollContent}
                                    showsVerticalScrollIndicator={false}
                                    keyboardShouldPersistTaps="handled"
                                    onScroll={scrollHandler}
                                    scrollEventThrottle={16}
                                    {...(Platform.OS === 'web' ? { className: 'bottom-sheet-scrollview' } : undefined)}
                                    onLayout={() => {
                                        if (Platform.OS === 'web') {
                                            createWebScrollbarStyle(theme.colors.border);
                                        }
                                    }}
                                >
                                    {children}
                                </Animated.ScrollView>
                        ) : (
                            /*
                             * Non-scrollable mode: the screen owns its own
                             * scrolling primitive (e.g. a FlatList). No outer
                             * pan/native gesture wrapping needed — the handle
                             * area above is the dedicated drag-to-dismiss
                             * surface, and the screen's own scroller is the
                             * only consumer of touches in this region.
                             */
                            <View style={styles.nonScrollableContent}>{children}</View>
                        )}
                    </Animated.View>
            </GestureHandlerRootView>
        </Modal>
    );
});

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
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
    /**
     * Hit area for the drag handle. Absolutely positioned at the top of the
     * sheet so the area visually "floats" above the content — content scrolls
     * up underneath it (no layout offset) while the thumb can still grab the
     * full-width 28dp strip to drag. The visible pill sits near the top of
     * the area (`paddingTop: 6`) so headers can sit immediately below the
     * 28dp hit-area boundary with no visible overlap.
     */
    handleHitArea: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: 28,
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingTop: 6,
        zIndex: 100,
    },
    handle: {
        width: 36,
        height: 5,
        borderRadius: 3,
    },
    background: {
        ...StyleSheet.absoluteFill,
    },
    scrollView: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
    },
    nonScrollableContent: {
        flex: 1,
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

    styleElement.textContent = `
        .bottom-sheet-scrollview::-webkit-scrollbar {
            width: 6px;
        }
        .bottom-sheet-scrollview::-webkit-scrollbar-track {
            background: transparent;
            border-radius: 10px;
        }
        .bottom-sheet-scrollview::-webkit-scrollbar-thumb {
            background: ${borderColor};
            border-radius: 10px;
        }
        .bottom-sheet-scrollview::-webkit-scrollbar-thumb:hover {
            background: ${borderColor};
        }
    `;
};

export default BottomSheet;