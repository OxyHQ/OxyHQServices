// filepath: /home/nate/OxyServicesandApi/OxyHQServices/src/ui/components/OxyProvider.tsx
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Animated, StatusBar, Keyboard, KeyboardEvent } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OxyServices } from '../../core';
import { OxyProviderProps } from '../navigation/types';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import AccountCenterScreen from '../screens/AccountCenterScreen';
import { OxyContextProvider, useOxy } from '../context/OxyContext';
import OxyRouter from '../navigation/OxyRouter';
import { FontLoader, setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';

// Import bottom sheet components directly - no longer a peer dependency
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModalProvider, BottomSheetView } from './bottomSheet';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useBottomSheetStore } from '../stores/bottomSheetStore';

// Initialize fonts automatically
setupFonts();

const { height, width } = Dimensions.get('window');

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
        ...bottomSheetProps
    } = props;

    // Create internal bottom sheet ref
    const internalBottomSheetRef = useRef<BottomSheetModal>(null);

    // If contextOnly is true, we just provide the context without the bottom sheet UI
    if (contextOnly) {
        return (
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
    return (
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
                    {/* Move Toaster outside BottomSheetModalProvider to ensure it appears above the modal backdrop */}
                    <View style={styles.toasterContainer}>
                        <Toaster position="top-center" swipeToDismissDirection="left" offset={15} />
                    </View>
                </GestureHandlerRootView>
            </FontLoader>
        </OxyContextProvider>
    );
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
}) => {
    // Use Zustand store for bottom sheet state
    const bottomSheetStore = useBottomSheetStore();
    
    // Use the internal ref (which is passed as a prop from OxyProvider)
    const modalRef = useRef<BottomSheetModal>(null);
    
    // Create a ref to store the navigation function from OxyRouter
    const navigationRef = useRef<((screen: string, props?: Record<string, any>) => void) | null>(null);

    // Use screen dimensions
    const screenHeight = Dimensions.get('window').height;

    // Create animated values once and store them in refs to avoid re-creation
    const fadeAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 1 : 0)).current;
    const slideAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 0 : 50)).current;
    const handleScaleAnim = useRef(new Animated.Value(1)).current;

    const insets = useSafeAreaInsets();

    // Get the authentication context
    const oxyContext = useOxy();

    // Initialize store with initial screen
    useEffect(() => {
        bottomSheetStore.setCurrentScreen(initialScreen);
    }, [initialScreen, bottomSheetStore]);

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
                    (global as any).oxyNavigateEvent = { screen: screenName, props };
                }
            };
        }
    }, [bottomSheetRef, modalRef]);

    // Use percentage-based snap points for better cross-platform compatibility  
    // Now managed by Zustand store
    
    // Animation values - we'll use these for content animations
    // Start with opacity 1 on Android to avoid visibility issues

    // Handle keyboard events
    useEffect(() => {
        const keyboardWillShowListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            (event: KeyboardEvent) => {
                bottomSheetStore.setKeyboardVisible(true);
                // Get keyboard height from event
                const keyboardHeightValue = event.endCoordinates.height;
                bottomSheetStore.setKeyboardHeight(keyboardHeightValue);

                // Update snap points for keyboard and ensure visibility
                bottomSheetStore.updateSnapPointsForKeyboard(screenHeight);

                // Ensure the bottom sheet remains visible when keyboard opens
                // by adjusting to the highest snap point
                if (modalRef.current) {
                    modalRef.current.snapToIndex(1);
                }
            }
        );

        const keyboardWillHideListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
            () => {
                bottomSheetStore.setKeyboardVisible(false);
                bottomSheetStore.setKeyboardHeight(0);
            }
        );

        // Cleanup listeners
        return () => {
            keyboardWillShowListener.remove();
            keyboardWillHideListener.remove();
        };
    }, [bottomSheetStore, screenHeight]);

    // Optimized animation helpers
    const runPresentationAnimation = useCallback(() => {
        bottomSheetStore.setPresented(true);
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: Platform.OS === 'ios',
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                friction: 8,
                tension: 40,
                useNativeDriver: Platform.OS === 'ios',
            }),
        ]).start();
    }, [fadeAnim, slideAnim, bottomSheetStore]);

    // Present the modal when component mounts, but only if autoPresent is true
    useEffect(() => {
        // Add expand method that handles presentation and animations
        if (bottomSheetRef && modalRef.current) {
            // Override expand to handle initial presentation
            // @ts-ignore - Dynamic method assignment
            bottomSheetRef.current.expand = () => {
                modalRef.current?.present();
                runPresentationAnimation();
            };

            // Override present to also handle animations
            // @ts-ignore - Dynamic method assignment
            bottomSheetRef.current.present = () => {
                modalRef.current?.present();
                runPresentationAnimation();
            };
        }

        // Auto-present if the autoPresent prop is true
        if (autoPresent && modalRef.current) {
            // Small delay to allow everything to initialize
            const timer = setTimeout(() => {
                modalRef.current?.present();
                runPresentationAnimation();
            }, 100);

            return () => clearTimeout(timer);
        }
    }, [bottomSheetRef, modalRef, autoPresent, runPresentationAnimation]);

    // Handle authentication success from the bottom sheet screens
    const handleAuthenticated = useCallback((user: any) => {
        // Call the prop callback if provided
        if (onAuthenticated) {
            onAuthenticated(user);
        }
    }, [onAuthenticated]);

    // Handle indicator animation - subtle pulse effect
    useEffect(() => {
        const pulseAnimation = Animated.sequence([
            Animated.timing(handleScaleAnim, {
                toValue: 1.1,
                duration: 300,
                useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
            }),
            Animated.timing(handleScaleAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
            }),
        ]);

        // Run the animation once when component mounts
        pulseAnimation.start();
    }, []);

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

    // Background style based on theme
    const getBackgroundStyle = () => {
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
    };

    // Method to adjust snap points from Router
    const adjustSnapPoints = useCallback((points: string[]) => {
        // Ensure snap points are high enough when keyboard is visible
        if (bottomSheetStore.keyboardVisible) {
            // If keyboard is visible, make sure we use higher snap points
            // to ensure the sheet content remains visible
            const highestPoint = points[points.length - 1];
            bottomSheetStore.setSnapPoints([highestPoint, highestPoint]);
        } else {
            // If we have content height, use it as a constraint
            if (bottomSheetStore.contentHeight > 0) {
                // Calculate content height as percentage of screen (plus some padding)
                const contentHeightPercent = Math.min(Math.ceil((bottomSheetStore.contentHeight + 40) / screenHeight * 100), 90) + '%';
                // Use content height for first snap point if it's taller than the default
                const firstPoint = bottomSheetStore.contentHeight / screenHeight > 0.6 ? contentHeightPercent : points[0];
                bottomSheetStore.setSnapPoints([firstPoint, points[1]]);
            } else {
                bottomSheetStore.setSnapPoints(points);
            }
        }
    }, [bottomSheetStore, screenHeight]);

    // Handle content layout changes to measure height
    const handleContentLayout = useCallback((event: any) => {
        const layoutHeight = event.nativeEvent.layout.height;
        bottomSheetStore.setContentHeight(layoutHeight);

        // Update snap points based on new content height
        bottomSheetStore.updateSnapPointsForContent(screenHeight);
    }, [bottomSheetStore, screenHeight]);

    // Close the bottom sheet with animation
    const handleClose = useCallback(() => {
        // Update store state
        bottomSheetStore.setPresented(false);
        
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
    }, [onClose, fadeAnim, bottomSheetStore]);

    // Handle sheet index changes
    const handleSheetChanges = useCallback((index: number) => {
        if (index === -1 && onClose) {
            bottomSheetStore.setPresented(false);
            onClose();
        } else if (index === 1) {
            // Pulse animation when expanded to full height
            Animated.sequence([
                Animated.timing(handleScaleAnim, {
                    toValue: 1.2,
                    duration: 200,
                    useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
                }),
                Animated.timing(handleScaleAnim, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: Platform.OS === 'ios', // Only use native driver on iOS
                }),
            ]).start();
        } else if (index === 0 && bottomSheetStore.keyboardVisible) {
            // If keyboard is visible and user tries to go to a smaller snap point,
            // force the sheet to stay at the highest point for better visibility
            modalRef.current?.snapToIndex(1);
        }
    }, [onClose, handleScaleAnim, bottomSheetStore]);

    return (
        <BottomSheetModal
            ref={modalRef}
            index={0}
            snapPoints={bottomSheetStore.snapPoints}
            enablePanDownToClose
            backdropComponent={renderBackdrop}
            // Remove enableDynamicSizing as we're implementing our own solution
            handleComponent={() => (
                <Animated.View
                    style={{
                        alignItems: 'center',
                        paddingVertical: 8,
                        ...(Platform.OS === 'ios' ? {
                            transform: [{ scale: handleScaleAnim }]
                        } : {})
                    }}
                >
                    <View style={[
                        styles.indicator,
                        { backgroundColor: customStyles.handleColor || (theme === 'light' ? '#CCCCCC' : '#444444') }
                    ]} />
                </Animated.View>
            )}
            backgroundStyle={[
                getBackgroundStyle(),
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
                        initialScreen={bottomSheetStore.currentScreen}
                        onClose={handleClose}
                        onAuthenticated={handleAuthenticated}
                        theme={theme}
                        adjustSnapPoints={adjustSnapPoints}
                        navigationRef={navigationRef}
                    />
                </Animated.View>
            </BottomSheetScrollView>
        </BottomSheetModal>
    );
};

const styles = StyleSheet.create({
    contentContainer: {
        width: '100%',
        backgroundColor: 'transparent', // Make this transparent to let the bottom sheet background show through
    },
    animatedContent: {
        width: '100%',
    },
    indicator: {
        width: 40,
        height: 4,
        alignSelf: 'center',
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
