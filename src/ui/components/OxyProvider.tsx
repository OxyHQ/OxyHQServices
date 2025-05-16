// filepath: /home/nate/OxyServicesandApi/OxyHQServices/src/ui/components/OxyProvider.tsx
import React, { useCallback, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Animated, StatusBar } from 'react-native';
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModalProvider, BottomSheetView } from '@gorhom/bottom-sheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OxyServices } from '../../core';
import { OxyProviderProps } from '../navigation/types';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import AccountCenterScreen from '../screens/AccountCenterScreen';
import { OxyContextProvider, useOxy } from '../context/OxyContext';
import OxyRouter from '../navigation/OxyRouter';
import { FontLoader, setupFonts } from './FontLoader';

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
        bottomSheetRef,
        ...bottomSheetProps
    } = props;

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
        >
            <FontLoader>
                <GestureHandlerRootView style={styles.gestureHandlerRoot}>
                    <BottomSheetModalProvider>
                        <StatusBar translucent backgroundColor="transparent" />
                        <SafeAreaProvider>
                            <OxyBottomSheet {...bottomSheetProps} bottomSheetRef={bottomSheetRef} oxyServices={oxyServices} />
                            {children}
                        </SafeAreaProvider>
                    </BottomSheetModalProvider>
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
    bottomSheetRef: externalRef,
    autoPresent = false,
}) => {
    // Use the provided external ref or create an internal one if not provided
    // Create our own BottomSheetModal ref to handle proper typings
    const internalRef = useRef<BottomSheetModal>(null);

    // Use a local ref that we know has the right type
    const modalRef = useRef<BottomSheetModal>(null);

    // Set up effect to sync the external ref with our local ref
    useEffect(() => {
        if (externalRef && modalRef.current) {
            // We need to expose certain methods to the external ref
            // This is a workaround for the type incompatibility
            const methodsToExpose = ['snapToIndex', 'snapToPosition', 'close', 'expand', 'collapse'];

            methodsToExpose.forEach((method) => {
                if (modalRef.current && typeof modalRef.current[method as keyof typeof modalRef.current] === 'function') {
                    // Properly forward methods from modalRef to externalRef
                    // @ts-ignore - We're doing a runtime compatibility layer
                    externalRef.current = externalRef.current || {};
                    // @ts-ignore - Dynamic method assignment
                    externalRef.current[method] = (...args: any[]) => {
                        // @ts-ignore - Dynamic method call
                        return modalRef.current?.[method]?.(...args);
                    };
                }
            });

            // Add a method to navigate between screens
            // @ts-ignore - Adding custom method
            externalRef.current._navigateToScreen = (screenName: string) => {
                // Access the navigation function exposed by OxyRouter
                // Use internal mechanism to notify router about navigation
                // We'll use a simple event-based approach
                if (typeof document !== 'undefined') {
                    // For web - use a custom event
                    const event = new CustomEvent('oxy:navigate', { detail: screenName });
                    document.dispatchEvent(event);
                } else {
                    // For React Native - use the navigation prop directly if available
                    console.log(`Requesting navigation to ${screenName}`);
                    // We'll implement a simpler mechanism in OxyRouter
                }
            };
        }
    }, [externalRef, modalRef]);

    // Use percentage-based snap points for better cross-platform compatibility
    const [snapPoints, setSnapPoints] = useState<(string | number)[]>(['60%', '85%']);

    // Animation values - we'll use these for content animations
    const fadeAnim = useRef(new Animated.Value(0)).current;
    const slideAnim = useRef(new Animated.Value(50)).current;
    const handleScaleAnim = useRef(new Animated.Value(1)).current;

    // Get the authentication context
    const oxyContext = useOxy();

    // Present the modal when component mounts, but only if autoPresent is true
    useEffect(() => {
        // Add expand method that handles presentation and animations
        if (externalRef && modalRef.current) {
            // Override expand to handle initial presentation
            // @ts-ignore - Dynamic method assignment
            externalRef.current.expand = () => {
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
    }, [externalRef, modalRef, fadeAnim, slideAnim, autoPresent]);

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
        setSnapPoints(points);
    }, []);

    // Method to programmatically navigate to a specific screen
    const navigateToScreen = useCallback((screenName: string) => {
        // If we have a router component with navigate method, use it
        if (modalRef.current) {
            // Store the navigate function on the modal ref so it can be accessed externally
            // @ts-ignore - Adding custom property for external navigation
            modalRef.current._navigateToScreen = (screen: string) => {
                // This will be populated by the OxyRouter component when it renders
                console.log(`Navigating to ${screen} programmatically`);
            };
        }
    }, []);

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

    // Handle sheet index changes
    const handleSheetChanges = useCallback((index: number) => {
        if (index === -1 && onClose) {
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
        }
    }, [onClose, handleScaleAnim]);

    return (
        <BottomSheetModal
            ref={modalRef}
            index={0}
            snapPoints={snapPoints}
            enablePanDownToClose
            backdropComponent={renderBackdrop}
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
            keyboardBehavior={Platform.OS === 'ios' ? 'interactive' : 'extend'}
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
            <BottomSheetView
                style={[
                    styles.contentContainer,
                    // Override padding if provided in customStyles
                    customStyles.contentPadding !== undefined && { padding: customStyles.contentPadding },
                ]}
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
                        initialScreen={initialScreen}
                        onClose={handleClose}
                        onAuthenticated={handleAuthenticated}
                        theme={theme}
                        adjustSnapPoints={adjustSnapPoints}
                    />
                </Animated.View>
            </BottomSheetView>
        </BottomSheetModal>
    );
};

const styles = StyleSheet.create({
    contentContainer: {
        flex: 1,
        padding: 16,
        width: '100%',
        height: '100%',
        backgroundColor: 'transparent', // Make this transparent to let the bottom sheet background show through
    },
    animatedContent: {
        flex: 1,
        width: '100%',
        height: '100%',
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
});

export default OxyProvider;
