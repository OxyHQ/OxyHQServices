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
import { Gesture, GestureDetector, GestureHandlerRootView, type GestureType } from 'react-native-gesture-handler';
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
    /**
     * Monotonically increasing counter that identifies "the current close
     * attempt". Bumped every time the user re-opens the sheet so that any
     * in-flight `withTiming` completion callback or fallback timer from a
     * PREVIOUS close cycle becomes a no-op. Without this guard, a stale
     * `runOnJS(finishClose)` from an aborted close would fire `onDismiss`
     * and unmount the sheet immediately after the user opens it again,
     * causing "tap to open does nothing" reports in production.
     *
     * Implemented as a JS ref (mutated from React) AND mirrored into a
     * SharedValue so gesture worklets can read the up-to-date value on the
     * UI thread without needing to be re-memoized after every reopen.
     */
    const closeGenerationRef = useRef(0);

    const translateY = useSharedValue(SCREEN_HEIGHT);
    const opacity = useSharedValue(0);
    const scrollOffsetY = useSharedValue(0);
    const keyboardHeight = useSharedValue(0);
    const context = useSharedValue({ y: 0 });
    // Mirror of `closeGenerationRef` for worklet access. Bumped from the JS
    // thread in lockstep with the ref so gesture worklets always see the
    // current generation when they snapshot it on `onEnd`.
    const closeGeneration = useSharedValue(0);

    // Refs used to mark the handle pan and the body pan as mutually
    // simultaneous. Without this RNGH treats them as racing gestures and a
    // touch that begins in the handle area could be claimed by whichever
    // recognizer activates first — leading to inconsistent drag start.
    const bodyPanRef = useRef<GestureType | undefined>(undefined);
    const handlePanRef = useRef<GestureType | undefined>(undefined);

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

    /**
     * Commit a close. Two guards prevent stale callbacks from firing:
     *   1. `hasClosedRef` — protects against the fallback timer AND the
     *      animation callback both racing to call us within a single close
     *      cycle.
     *   2. `generation` — protects against a callback from a PREVIOUS close
     *      cycle firing AFTER the user reopened. If the live generation has
     *      advanced past the one captured when the close started, this
     *      callback is from a cycle that the user has implicitly cancelled
     *      by reopening — silently drop it.
     */
    const finishClose = useCallback((generation: number) => {
        if (closeGenerationRef.current !== generation) return;
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
            // Bump generation: any pending close-completion callback from a
            // prior cycle (animation or fallback timer) will now no-op when
            // it eventually fires, because its captured generation is stale.
            closeGenerationRef.current += 1;
            closeGeneration.value = closeGenerationRef.current;
            opacity.value = withTiming(1, { duration: 250 });
            translateY.value = withSpring(0, SPRING_CONFIG);
        } else if (rendered) {
            // Capture the generation for THIS close cycle so the animation
            // callback (running on the UI thread, scheduled back to JS) and
            // the fallback timer agree on which cycle they belong to.
            const generation = closeGenerationRef.current;
            opacity.value = withTiming(0, { duration: 250 }, (finished) => {
                if (finished) {
                    runOnJS(finishClose)(generation);
                }
            });
            translateY.value = withSpring(SCREEN_HEIGHT, { ...SPRING_CONFIG, stiffness: 250 });

            // Fallback timer to ensure close completes (especially on web
            // where reanimated callbacks occasionally drop on tab blur).
            if (closeTimeoutRef.current) {
                clearTimeout(closeTimeoutRef.current);
            }
            closeTimeoutRef.current = setTimeout(() => {
                finishClose(generation);
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

    // Body pan-to-dismiss. The pan uses `manualActivation` and only flips
    // itself to active when (a) the inner ScrollView is at the top AND (b) the
    // user is moving their finger downward beyond a small threshold. In every
    // other case (mid-scroll, upward pulls) it fails and the ScrollView keeps
    // full ownership of the touch. This is the same coordination model
    // @gorhom/bottom-sheet uses and is the only RNGH 2.x pattern that does
    // not steal vertical events from the inner scroller on Android.
    const touchStartY = useSharedValue(0);
    const panGesture = useMemo(
        () =>
            Gesture.Pan()
                .enabled(enablePanDownToClose)
                .withRef(bodyPanRef)
                .manualActivation(true)
                .simultaneousWithExternalGesture(scrollViewRef, handlePanRef)
                .onTouchesDown((e) => {
                    'worklet';
                    const t = e.changedTouches[0];
                    if (t) touchStartY.value = t.absoluteY;
                    context.value = { y: translateY.value };
                })
                .onTouchesMove((e, state) => {
                    'worklet';
                    const t = e.changedTouches[0];
                    if (!t) return;
                    const dy = t.absoluteY - touchStartY.value;
                    const atTop = scrollOffsetY.value <= 4;
                    // Activate only when (at scroll top) AND (finger has moved
                    // downward by > 8dp). Any other motion: fail so the
                    // ScrollView claims the gesture.
                    if (atTop && dy > 8) {
                        state.activate();
                    } else if (dy < -4 || !atTop) {
                        state.fail();
                    }
                })
                .onUpdate((event) => {
                    'worklet';
                    if (event.translationY < 0) return;
                    const newTranslateY = context.value.y + event.translationY;
                    if (newTranslateY >= 0) {
                        translateY.value = newTranslateY;
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
                        // Snapshot the generation on the UI thread at the
                        // moment the close gesture commits. The completion
                        // callback only fires `finishClose` if no reopen
                        // bumped the generation in between.
                        const generation = closeGeneration.value;
                        translateY.value = withSpring(SCREEN_HEIGHT, { ...SPRING_CONFIG, velocity });
                        opacity.value = withTiming(0, { duration: 250 }, (finished) => {
                            if (finished) runOnJS(finishClose)(generation);
                        });
                    } else {
                        translateY.value = withSpring(0, { ...SPRING_CONFIG, velocity });
                    }
                }),
        [
            closeGeneration,
            context,
            enablePanDownToClose,
            finishClose,
            opacity,
            scrollOffsetY,
            touchStartY,
            translateY,
        ],
    );

    // Dedicated pan for the handle — unconditional, always drags.
    const handlePanGesture = useMemo(
        () =>
            Gesture.Pan()
                .enabled(enablePanDownToClose && enableHandlePanningGesture)
                .withRef(handlePanRef)
                .simultaneousWithExternalGesture(bodyPanRef)
                .activeOffsetY([-8, 8])
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
                        const generation = closeGeneration.value;
                        translateY.value = withSpring(SCREEN_HEIGHT, {
                            ...SPRING_CONFIG,
                            velocity: velocity,
                        });
                        opacity.value = withTiming(0, { duration: 250 }, (finished) => {
                            if (finished) {
                                runOnJS(finishClose)(generation);
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
            closeGeneration,
            context,
            detached,
            enableHandlePanningGesture,
            enablePanDownToClose,
            finishClose,
            opacity,
            translateY,
        ],
    );

    // Backdrop dims proportionally as the sheet is dragged downward (iOS
    // Photos-style). The base `opacity` value controls the open/close fade;
    // we multiply it by a drag-distance factor so partial pulls also dim the
    // overlay, snapping back when the user releases.
    const backdropStyle = useAnimatedStyle(() => {
        const dragFactor = interpolate(
            translateY.value,
            [0, SCREEN_HEIGHT * 0.4],
            [1, 0.3],
            'clamp',
        );
        return {
            opacity: opacity.value * dragFactor,
        };
    });

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

                <GestureDetector gesture={panGesture}>
                    <Animated.View style={[dynamicStyles.sheet, sheetMarginStyle, sheetStyle, sheetHeightStyle]}>
                        {backgroundComponent?.({ style: styles.background })}

                        {/*
                         * Handle area — dedicated pan that always drags the
                         * sheet, even when content is mid-scroll. The outer
                         * body pan above gates on scroll position; this one
                         * is unconditional.
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
                </GestureDetector>
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