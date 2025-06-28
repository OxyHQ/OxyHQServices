import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Animated, StatusBar, Keyboard, KeyboardEvent } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OxyProviderProps } from '../navigation/types';
import { OxyContextProvider, useOxy } from '../context/OxyContext';
import { Provider } from 'react-redux';
import { store } from '../store';
import OxyRouter from '../navigation/OxyRouter';
import { FontLoader, setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';

// Import bottom sheet components directly - no longer a peer dependency
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModalProvider, BottomSheetView, BottomSheetScrollView } from './bottomSheet';
import type { BottomSheetModalRef } from './bottomSheet';

// Initialize fonts automatically
setupFonts();

/**
 * Enhanced OxyProvider component
 * 
 * This component serves two purposes:
 * 1. As a context provider for authentication and session management across the app
 * 2. As a UI component for authentication and account management using a bottom sheet
 */
const OxyProvider: React.FC<OxyProviderProps> = (props) => {
    const {
        oxyServices,
        children,
        contextOnly = false,
        onAuthStateChange,
        storageKeyPrefix,
        showInternalToaster = true,
        store: externalStore,
        skipReduxProvider = false,
        ...bottomSheetProps
    } = props;

    // Create internal bottom sheet ref
    const internalBottomSheetRef = useRef<BottomSheetModalRef>(null);

    // Determine which store to use
    const storeToUse = externalStore || store;

    // Helper function to wrap content with Redux Provider if needed
    const wrapWithReduxProvider = (content: React.ReactNode) => {
        if (skipReduxProvider) {
            // App manages Redux Provider externally
            return content;
        }
        
        return (
            <Provider store={storeToUse}>
                {content}
            </Provider>
        );
    };

    // If contextOnly is true, we just provide the context without the bottom sheet UI
    if (contextOnly) {
        return wrapWithReduxProvider(
            <OxyContextProvider
                oxyServices={oxyServices}
                storageKeyPrefix={storageKeyPrefix}
                onAuthStateChange={onAuthStateChange}
            >
                {children}
            </OxyContextProvider>
        );
    }

    // Otherwise, provide both the context and the bottom sheet UI
    return wrapWithReduxProvider(
        <OxyContextProvider
            oxyServices={oxyServices}
            storageKeyPrefix={storageKeyPrefix}
            onAuthStateChange={onAuthStateChange}
            bottomSheetRef={internalBottomSheetRef}
        >
            <FontLoader>
                <GestureHandlerRootView style={styles.gestureHandlerRoot}>
                    <BottomSheetModalProvider>
                        <StatusBar translucent backgroundColor="transparent" />
                        <SafeAreaProvider>
                            <OxyBottomSheet {...bottomSheetProps} bottomSheetRef={internalBottomSheetRef} oxyServices={oxyServices} />
                            {children}
                        </SafeAreaProvider>
                    </BottomSheetModalProvider>
                    {/* Global Toaster for app-wide notifications outside of Modal contexts - only show if internal toaster is disabled */}
                    {!showInternalToaster && (
                        <View style={styles.toasterContainer}>
                            <Toaster position="top-center" swipeToDismissDirection="left" offset={15} />
                        </View>
                    )}
                </GestureHandlerRootView>
            </FontLoader>
        </OxyContextProvider>
    );
};
};

/**
 * OxyBottomSheet component - A bottom sheet-based authentication and account management UI
 * 
 * This is the original OxyProvider UI functionality, now extracted into its own component
 * and reimplemented using BottomSheetModal for better Android compatibility
 */
const OxyBottomSheet: React.FC<OxyProviderProps> = ({
    oxyServices,
    initialScreen = 'SignIn',
    onClose,
    onAuthenticated,
    theme = 'light',
    customStyles = {},
    bottomSheetRef,
    autoPresent = false,
    showInternalToaster = true,
}) => {
    // Use the internal ref (which is passed as a prop from OxyProvider)
    const modalRef = useRef<BottomSheetModalRef>(null);

    // Create a ref to store the navigation function from OxyRouter
    const navigationRef = useRef<((screen: string, props?: Record<string, any>) => void) | null>(null);

    // Track content height for dynamic sizing
    const [contentHeight, setContentHeight] = useState<number>(0);
    const [containerWidth, setContainerWidth] = useState<number>(800); // Track actual container width
    const screenHeight = Dimensions.get('window').height;

    // Set up effect to sync the internal ref with our modal ref
    useEffect(() => {
        if (bottomSheetRef && modalRef.current) {
            // We need to expose certain methods to the internal ref
            const methodsToExpose = ['snapToIndex', 'snapToPosition', 'close', 'expand', 'collapse', 'present', 'dismiss'];

            methodsToExpose.forEach((method) => {
                if (modalRef.current && typeof modalRef.current[method as keyof typeof modalRef.current] === 'function') {
                    // Properly forward methods from modalRef to bottomSheetRef
                    // @ts-ignore - We're doing a runtime compatibility layer
                    bottomSheetRef.current = bottomSheetRef.current || {};
                    // @ts-ignore - Dynamic method assignment
                    bottomSheetRef.current[method] = (...args: any[]) => {
                        // @ts-ignore - Dynamic method call
                        return modalRef.current?.[method]?.(...args);
                    };
                }
            });

            // Add a method to navigate between screens
            // @ts-ignore - Adding custom method
            bottomSheetRef.current._navigateToScreen = (screenName: string, props?: Record<string, any>) => {
                console.log(`Navigation requested: ${screenName}`, props);

                // Try direct navigation function first (most reliable)
                if (navigationRef.current) {
                    console.log('Using direct navigation function');
                    navigationRef.current(screenName, props);
                    return;
                }

                // Fallback to event-based navigation
                if (typeof document !== 'undefined') {
                    // For web - use a custom event
                    console.log('Using web event navigation');
                    const event = new CustomEvent('oxy:navigate', { detail: { screen: screenName, props } });
                    document.dispatchEvent(event);
                } else {
                    // For React Native - use the global variable approach
                    console.log('Using React Native global navigation');
                    (globalThis as any).oxyNavigateEvent = { screen: screenName, props };
                }
            };
        }
    }, [bottomSheetRef, modalRef]);

    // Use percentage-based snap points for better cross-platform compatibility
    const [snapPoints, setSnapPoints] = useState<(string | number)[]>(['60%', '90%']);

    // Animation values - we'll use these for content animations
    // Start with opacity 1 on Android to avoid visibility issues
    const fadeAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 1 : 0)).current;
    const slideAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 0 : 50)).current;

    // Track keyboard status
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const insets = useSafeAreaInsets();

    // Handle keyboard events - memoized to prevent re-registration
    useEffect(() => {
        const keyboardWillShowListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            (event: KeyboardEvent) => {
                setKeyboardVisible(true);
                // Ensure the bottom sheet remains visible when keyboard opens
                // by adjusting to the highest snap point
                if (modalRef.current) {
                    // Use requestAnimationFrame to avoid conflicts
                    requestAnimationFrame(() => {
                        modalRef.current?.snapToIndex(1);
                    });
                }
            }
        );

        const keyboardWillHideListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            () => {
                setKeyboardVisible(false);
            }
        );

        // Cleanup listeners
        return () => {
            keyboardWillShowListener.remove();
            keyboardWillHideListener.remove();
        };
    }, []); // Remove keyboardVisible dependency to prevent re-registration

    // Present the modal when component mounts, but only if autoPresent is true
    useEffect(() => {
        // Add expand method that handles presentation and animations
        if (bottomSheetRef && modalRef.current) {
            // Override expand to handle initial presentation
            // @ts-ignore - Dynamic method assignment
            bottomSheetRef.current.expand = () => {
                // Only present if not already presented
                modalRef.current?.present();

                // Start content animations after presenting
                Animated.parallel([
                    Animated.timing(fadeAnim, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
                    }),
                    Animated.spring(slideAnim, {
                        toValue: 0,
                        friction: 8,
                        tension: 40,
                        useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
                    }),
                ]).start();
            };
        }

        // Auto-present if the autoPresent prop is true
        if (autoPresent && modalRef.current) {
            // Small delay to allow everything to initialize
            const timer = setTimeout(() => {
                modalRef.current?.present();

                // Start content animations after presenting
                Animated.parallel([
                    Animated.timing(fadeAnim, {
                        toValue: 1,
                        duration: 300,
                        useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
                    }),
                    Animated.spring(slideAnim, {
                        toValue: 0,
                        friction: 8,
                        tension: 40,
                        useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
                    }),
                ]).start();
            }, 100);

            return () => clearTimeout(timer);
        }
    }, [bottomSheetRef, modalRef, fadeAnim, slideAnim, autoPresent]);

    // Close the bottom sheet with animation
    const handleClose = useCallback(() => {
        // Animate content out
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: Platform.OS === 'android' ? 100 : 200, // Faster on Android
            useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
        }).start(() => {
            // Dismiss the sheet
            modalRef.current?.dismiss();
            if (onClose) {
                setTimeout(() => {
                    onClose();
                }, Platform.OS === 'android' ? 150 : 100);
            }
        });
    }, [onClose, fadeAnim]);

    // Handle authentication success from the bottom sheet screens
    const handleAuthenticated = useCallback((user: any) => {
        // Stop any ongoing animations that might interfere with dismissal
        fadeAnim.stopAnimation();
        slideAnim.stopAnimation();

        // Call the prop callback if provided
        if (onAuthenticated) {
            onAuthenticated(user);
        }

        // Automatically dismiss the bottom sheet after successful authentication
        // Use direct dismissal for immediate closure
        modalRef.current?.dismiss();

        // Call onClose callback if provided
        if (onClose) {
            setTimeout(() => {
                onClose();
            }, 100);
        }
    }, [onAuthenticated, onClose, fadeAnim, slideAnim]);

    // Remove handle animation to prevent conflicts with bottom sheet animations

    // Handle backdrop rendering
    const renderBackdrop = useCallback(
        (props: BottomSheetBackdropProps) => (
            <BottomSheetBackdrop
                {...props}
                disappearsOnIndex={-1}
                appearsOnIndex={0}
                opacity={0.5}
            />
        ),
        []
    );

    // Memoize background style based on theme to prevent recalculation on every render
    const backgroundStyle = useMemo(() => {
        const baseColor = customStyles.backgroundColor || (theme === 'light' ? '#FFFFFF' : '#121212');
        return {
            backgroundColor: baseColor,
            // Make sure there's no transparency
            opacity: 1,
            // Additional Android-specific styles
            ...Platform.select({
                android: {
                    elevation: 24,
                }
            })
        };
    }, [customStyles.backgroundColor, theme]);

    // Method to adjust snap points from Router - memoized with stable dependencies
    const adjustSnapPoints = useCallback((points: string[]) => {
        setSnapPoints(prevSnapPoints => {
            // Ensure snap points are high enough when keyboard is visible
            if (keyboardVisible) {
                // If keyboard is visible, make sure we use higher snap points
                // to ensure the sheet content remains visible
                const highestPoint = points[points.length - 1];
                const newSnapPoints = [highestPoint, highestPoint];
                // Only update if actually different
                if (JSON.stringify(prevSnapPoints) !== JSON.stringify(newSnapPoints)) {
                    return newSnapPoints;
                }
                return prevSnapPoints;
            } else {
                // If we have content height, use it as a constraint
                if (contentHeight > 0) {
                    // Calculate content height as percentage of screen (plus some padding)
                    // Clamp to ensure we don't exceed 90% to leave space for UI elements
                    const contentHeightPercent = Math.min(Math.ceil((contentHeight) / screenHeight * 100), 90);
                    const contentHeightPercentStr = `${contentHeightPercent}%`;
                    // Use content height for first snap point if it's taller than the default
                    const firstPoint = contentHeight / screenHeight > 0.6 ? contentHeightPercentStr : points[0];
                    const newSnapPoints = [firstPoint, points[1] || '90%'];
                    // Only update if actually different
                    if (JSON.stringify(prevSnapPoints) !== JSON.stringify(newSnapPoints)) {
                        return newSnapPoints;
                    }
                    return prevSnapPoints;
                } else {
                    // Only update if actually different
                    if (JSON.stringify(prevSnapPoints) !== JSON.stringify(points)) {
                        return points;
                    }
                    return prevSnapPoints;
                }
            }
        });
    }, [keyboardVisible, contentHeight, screenHeight]);

    // Handle content layout changes to measure height and width - prevent rerender loops
    const handleContentLayout = useCallback((event: any) => {
        const { height: layoutHeight, width: layoutWidth } = event.nativeEvent.layout;

        // Only update if values actually changed to prevent unnecessary rerenders
        setContentHeight(prevHeight => {
            if (Math.abs(prevHeight - layoutHeight) > 5) { // 5px threshold to prevent minor fluctuations
                return layoutHeight;
            }
            return prevHeight;
        });

        setContainerWidth(prevWidth => {
            if (Math.abs(prevWidth - layoutWidth) > 5) { // 5px threshold to prevent minor fluctuations
                return layoutWidth;
            }
            return prevWidth;
        });
    }, []); // Remove dependencies that cause rerender loops

    // Handle sheet index changes - simplified to prevent unnecessary rerenders
    const handleSheetChanges = useCallback((index: number) => {
        // Sheet change handling can be added here if needed
    }, []);

    return (
        <BottomSheetModal
            ref={modalRef}
            index={0}
            snapPoints={snapPoints}
            enablePanDownToClose
            backdropComponent={renderBackdrop}
            backgroundStyle={[
                backgroundStyle,
                {
                    borderTopLeftRadius: 35,
                    borderTopRightRadius: 35,
                }
            ]}
            handleIndicatorStyle={{
                backgroundColor: customStyles.handleColor || (theme === 'light' ? '#CCCCCC' : '#444444'),
                width: 40,
                height: 4,
            }}
            onChange={handleSheetChanges}
            style={styles.bottomSheetContainer}
            // Adding additional props to improve layout behavior
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            enableOverDrag={true}
            enableContentPanningGesture={true}
            enableHandlePanningGesture={true}
            overDragResistanceFactor={2.5}
            enableBlurKeyboardOnGesture={true}
            // Log sheet animations for debugging
            onAnimate={(fromIndex: number, toIndex: number) => {
                console.log(`Animating from index ${fromIndex} to ${toIndex}`);
            }}
        >
            <BottomSheetScrollView
                style={[
                    styles.contentContainer,
                    // Override padding if provided in customStyles
                    customStyles.contentPadding !== undefined && { padding: customStyles.contentPadding },
                ]}
                onLayout={handleContentLayout}
            >
                <View style={styles.centeredContentWrapper}>
                    <Animated.View
                        style={[
                            styles.animatedContent,
                            // Apply animations - conditionally for Android
                            Platform.OS === 'android' ?
                                {
                                    opacity: 1,  // No fade animation on Android
                                } : {
                                    opacity: fadeAnim,
                                    transform: [{ translateY: slideAnim }]
                                }
                        ]}
                    >
                        <OxyRouter
                            oxyServices={oxyServices}
                            initialScreen={initialScreen}
                            onClose={handleClose}
                            onAuthenticated={handleAuthenticated}
                            theme={theme}
                            adjustSnapPoints={adjustSnapPoints}
                            navigationRef={navigationRef}
                            containerWidth={containerWidth}
                        />
                    </Animated.View>
                </View>
            </BottomSheetScrollView>
            {/* Internal toaster - only show if showInternalToaster is true */}
            {showInternalToaster && (
                <View style={styles.toasterContainer}>
                    <Toaster position="top-center" swipeToDismissDirection="left" />
                </View>
            )}
        </BottomSheetModal>
    );
};

const styles = StyleSheet.create({
    bottomSheetContainer: {
        maxWidth: 800,
        width: '100%',
        marginHorizontal: 'auto',
    },
    contentContainer: {
        width: '100%',
        borderTopLeftRadius: 35,
        borderTopRightRadius: 35,
    },
    centeredContentWrapper: {
        width: '100%',
        marginHorizontal: 'auto',
    },
    animatedContent: {
        width: '100%',
    },
    indicator: {
        width: 40,
        height: 4,
        marginTop: 8,
        marginBottom: 8,
        borderRadius: 35,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    gestureHandlerRoot: {
        flex: 1,
        position: 'relative',
        backgroundColor: 'transparent',
        ...Platform.select({

            android: {
                height: '100%',
                width: '100%',
            }
        })
    },
    toasterContainer: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        elevation: 9999, // For Android
        pointerEvents: 'box-none', // Allow touches to pass through to underlying components
    },
});

export default OxyProvider;
