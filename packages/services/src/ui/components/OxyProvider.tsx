import React, { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Animated, StatusBar, Keyboard, KeyboardEvent } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OxyProviderProps } from '../navigation/types';
import { OxyContextProvider, useOxy } from '../context/OxyContext';
import OxyRouter from '../navigation/OxyRouter';
import { FontLoader, setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';

// Import bottom sheet components directly - no longer a peer dependency
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModalProvider, BottomSheetView, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import type { BottomSheetModalMethods as BottomSheetModalRef } from '@gorhom/bottom-sheet/lib/typescript/types';

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
        baseURL, // Add support for baseURL
        ...bottomSheetProps
    } = props;

    // Create internal bottom sheet ref
    const internalBottomSheetRef = useRef<BottomSheetModalRef>(null);

    // If contextOnly is true, we just provide the context without the bottom sheet UI
    if (contextOnly) {
        return (
            <OxyContextProvider
                oxyServices={oxyServices}
                baseURL={baseURL}
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
            baseURL={baseURL}
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

/**
 * OxyBottomSheet component - A bottom sheet-based authentication and account management UI
 * 
 * This is the original OxyProvider UI functionality, now extracted into its own component
 * and reimplemented using BottomSheetModal for better Android compatibility
 */
const OxyBottomSheet: React.FC<OxyProviderProps> = ({
    oxyServices: providedOxyServices,
    initialScreen = 'SignIn',
    onClose,
    onAuthenticated,
    theme = 'light',
    customStyles = {},
    bottomSheetRef,
    autoPresent = false,
    showInternalToaster = true,
}) => {
    // Get oxyServices from context if not provided as prop
    const contextOxy = useOxy();
    const oxyServices = providedOxyServices || contextOxy?.oxyServices;
    // Use the internal ref (which is passed as a prop from OxyProvider)
    const modalRef = useRef<BottomSheetModalRef>(null);
    const navigationRef = useRef<((screen: string, props?: Record<string, any>) => void) | null>(null);
    // Remove contentHeight, containerWidth, and snap point state/logic
    // Animation values - keep for content fade/slide
    const fadeAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 1 : 0)).current;
    const slideAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 0 : 50)).current;
    useEffect(() => {
        if (bottomSheetRef && modalRef.current) {
            const methodsToExpose = ['snapToIndex', 'snapToPosition', 'close', 'expand', 'collapse', 'present', 'dismiss'];
            methodsToExpose.forEach((method) => {
                if (modalRef.current && typeof modalRef.current[method as keyof typeof modalRef.current] === 'function') {
                    // @ts-ignore
                    bottomSheetRef.current = bottomSheetRef.current || {};
                    // @ts-ignore
                    bottomSheetRef.current[method] = (...args: any[]) => {
                        // @ts-ignore
                        return modalRef.current?.[method]?.(...args);
                    };
                }
            });
            // Add a method to navigate between screens
            // @ts-ignore
            bottomSheetRef.current._navigateToScreen = (screenName: string, props?: Record<string, any>) => {
                if (navigationRef.current) {
                    navigationRef.current(screenName, props);
                    return;
                }
                if (typeof document !== 'undefined') {
                    const event = new CustomEvent('oxy:navigate', { detail: { screen: screenName, props } });
                    document.dispatchEvent(event);
                } else {
                    (globalThis as any).oxyNavigateEvent = { screen: screenName, props };
                }
            };
        }
    }, [bottomSheetRef, modalRef]);
    // Keyboard handling (unchanged)
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const insets = useSafeAreaInsets();
    useEffect(() => {
        const keyboardWillShowListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            () => {
                setKeyboardVisible(true);
                if (modalRef.current) {
                    requestAnimationFrame(() => {
                        modalRef.current?.expand?.();
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
        return () => {
            keyboardWillShowListener.remove();
            keyboardWillHideListener.remove();
        };
    }, []);
    // Present the modal when component mounts, but only if autoPresent is true
    useEffect(() => {
        if (bottomSheetRef && modalRef.current) {
            // @ts-ignore
            bottomSheetRef.current.expand = () => {
                modalRef.current?.present();
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
            };
        }
        if (autoPresent && modalRef.current) {
            const timer = setTimeout(() => {
                modalRef.current?.present();
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
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [bottomSheetRef, modalRef, fadeAnim, slideAnim, autoPresent]);
    // Close the bottom sheet with animation (unchanged)
    const handleClose = useCallback(() => {
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: Platform.OS === 'android' ? 100 : 200,
            useNativeDriver: Platform.OS === 'ios',
        }).start(() => {
            modalRef.current?.dismiss();
            if (onClose) {
                setTimeout(() => {
                    onClose();
                }, Platform.OS === 'android' ? 150 : 100);
            }
        });
    }, [onClose, fadeAnim]);
    // Handle authentication success (unchanged)
    const handleAuthenticated = useCallback((user: any) => {
        fadeAnim.stopAnimation();
        slideAnim.stopAnimation();
        if (onAuthenticated) {
            onAuthenticated(user);
        }
        modalRef.current?.dismiss();
        if (onClose) {
            setTimeout(() => {
                onClose();
            }, 100);
        }
    }, [onAuthenticated, onClose, fadeAnim, slideAnim]);
    // Backdrop rendering (unchanged)
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
    // Memoize background style
    const backgroundStyle = useMemo(() => {
        const baseColor = customStyles.backgroundColor || (theme === 'light' ? '#FFFFFF' : '#121212');
        return {
            backgroundColor: baseColor,
            opacity: 1,
            ...Platform.select({
                android: { elevation: 24 },
            })
        };
    }, [customStyles.backgroundColor, theme]);
    // Handle sheet index changes (unchanged)
    const handleSheetChanges = useCallback((index: number) => { }, []);
    // Modernized BottomSheetModal usage
    return (
        <BottomSheetModal
            ref={modalRef}
            index={0}
            enableDynamicSizing={true}
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
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            enableOverDrag={false}
            enableContentPanningGesture={true}
            enableHandlePanningGesture={true}
            overDragResistanceFactor={2.5}
            enableBlurKeyboardOnGesture={true}
            detached
            // Uncomment below to use a sticky footer
            // footerComponent={<YourFooterComponent />}
            onAnimate={(fromIndex: number, toIndex: number) => {
                console.log(`Animating from index ${fromIndex} to ${toIndex}`);
            }}
        >
            <BottomSheetScrollView
                style={[
                    styles.contentContainer,
                ]}
            >
                <View style={styles.centeredContentWrapper}>
                    <Animated.View
                        style={[
                            styles.animatedContent,
                            Platform.OS === 'android' ?
                                { opacity: 1 } :
                                { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }
                        ]}
                    >
                        {oxyServices ? (
                            <OxyRouter
                                oxyServices={oxyServices}
                                initialScreen={initialScreen}
                                onClose={handleClose}
                                onAuthenticated={handleAuthenticated}
                                theme={theme}
                                navigationRef={navigationRef}
                                containerWidth={800} // static, since dynamic sizing is used
                            />
                        ) : (
                            <View style={styles.errorContainer}>
                                <Text>OxyServices not available</Text>
                            </View>
                        )}
                    </Animated.View>
                </View>
            </BottomSheetScrollView>
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
