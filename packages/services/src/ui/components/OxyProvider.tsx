import type React from 'react';
import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Animated, StatusBar, Keyboard, KeyboardEvent, AppState } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import type { OxyProviderProps } from '../navigation/types';
import { OxyContextProvider, useOxy } from '../context/OxyContext';
import OxyRouter from '../navigation/OxyRouter';
import { FontLoader, setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';
import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';

// Import bottom sheet components directly - no longer a peer dependency
import { BottomSheetModal, BottomSheetBackdrop, type BottomSheetBackdropProps, BottomSheetModalProvider, BottomSheetView, BottomSheetScrollView } from '@gorhom/bottom-sheet';
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

    // Initialize React Query Client (use provided client or create a default one once)
    const queryClientRef = useRef<QueryClient | null>(null);
    if (!queryClientRef.current) {
        queryClientRef.current = props.queryClient ?? new QueryClient({
            defaultOptions: {
                queries: {
                    staleTime: 30_000,
                    gcTime: 5 * 60_000,
                    retry: 2,
                    refetchOnReconnect: true,
                    refetchOnWindowFocus: false,
                },
                mutations: {
                    retry: 1,
                },
            },
        });
    }

    // Hook React Query focus manager into React Native AppState
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            focusManager.setFocused(state === 'active');
        });
        return () => {
            subscription.remove();
        };
    }, []);

    // If contextOnly is true, we just provide the context without the bottom sheet UI
    if (contextOnly) {
        return (
            <QueryClientProvider client={queryClientRef.current}>
                <OxyContextProvider
                    oxyServices={oxyServices}
                    baseURL={baseURL}
                    storageKeyPrefix={storageKeyPrefix}
                    onAuthStateChange={onAuthStateChange}
                >
                    {children}
                </OxyContextProvider>
            </QueryClientProvider>
        );
    }

    // Otherwise, provide both the context and the bottom sheet UI
    return (
        <QueryClientProvider client={queryClientRef.current}>
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
        </QueryClientProvider>
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
    appInsets,
}) => {
    // Helper function to determine if native driver should be used
    const shouldUseNativeDriver = () => {
        return Platform.OS === 'ios';
    };
    // Get oxyServices from context if not provided as prop
    const contextOxy = useOxy();
    const oxyServices = providedOxyServices || contextOxy?.oxyServices;
    // Use the internal ref (which is passed as a prop from OxyProvider)
    const modalRef = useRef<BottomSheetModalRef>(null);
    const navigationRef = useRef<((screen: string, props?: Record<string, unknown>) => void) | null>(null);
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
                console.log('_navigateToScreen called with:', screenName, props);
                if (navigationRef.current) {
                    console.log('Using navigationRef.current');
                    navigationRef.current(screenName, props);
                    return;
                }
                console.log('navigationRef.current not available, using event system');
                if (typeof document !== 'undefined') {
                    const event = new CustomEvent('oxy:navigate', { detail: { screen: screenName, props } });
                    document.dispatchEvent(event);
                } else {
                    (globalThis as any).oxyNavigateEvent = { screen: screenName, props };
                }
            };

            if (bottomSheetRef.current && typeof bottomSheetRef.current === 'object') {
                console.log('Bottom sheet ref methods exposed:', Object.keys(bottomSheetRef.current));
            }
        }
    }, [bottomSheetRef, modalRef]);
    // Keyboard handling (unchanged)
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const insets = useSafeAreaInsets();
    useEffect(() => {
        const keyboardWillShowListener = Keyboard.addListener(
            Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
            (e: KeyboardEvent) => {
                setKeyboardVisible(true);
                setKeyboardHeight(e?.endCoordinates?.height ?? 0);
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
                setKeyboardHeight(0);
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
                        useNativeDriver: shouldUseNativeDriver(),
                    }),
                    Animated.spring(slideAnim, {
                        toValue: 0,
                        friction: 8,
                        tension: 40,
                        useNativeDriver: shouldUseNativeDriver(),
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
                        useNativeDriver: shouldUseNativeDriver(),
                    }),
                    Animated.spring(slideAnim, {
                        toValue: 0,
                        friction: 8,
                        tension: 40,
                        useNativeDriver: shouldUseNativeDriver(),
                    }),
                ]).start();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [bottomSheetRef, modalRef, autoPresent]);
    // Close the bottom sheet with animation (unchanged)
    const handleClose = useCallback(() => {
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: Platform.OS === 'android' ? 100 : 200,
            useNativeDriver: shouldUseNativeDriver(),
        }).start(() => {
            modalRef.current?.dismiss();
            if (onClose) {
                setTimeout(() => {
                    onClose();
                }, Platform.OS === 'android' ? 150 : 100);
            }
        });
    }, [onClose]);
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
    }, [onAuthenticated, onClose]);
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
                {
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                    borderTopLeftRadius: 35,
                    borderTopRightRadius: 35,
                }
            ]}
            handleIndicatorStyle={{
                backgroundColor: customStyles.handleColor || (theme === 'light' ? '#CCCCCC' : '#444444'),
                width: 40,
                height: 4,
            }}
            handleStyle={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
            }}
            onChange={handleSheetChanges}
            style={styles.bottomSheetContainer}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustPan"
            enableOverDrag={false}
            enableContentPanningGesture={true}
            enableHandlePanningGesture={true}
            overDragResistanceFactor={2.5}
            enableBlurKeyboardOnGesture={true}
            detached
            topInset={(insets?.top ?? 0) + (appInsets?.top ?? 0)}
            bottomInset={(keyboardVisible ? (keyboardHeight + (0)) : 0) + (appInsets?.bottom ?? 0)}
        >
            <BottomSheetScrollView
                style={[
                    styles.contentContainer,
                ]}
                contentContainerStyle={{ paddingBottom: (insets?.bottom ?? 0) + (appInsets?.bottom ?? 0) }}
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
