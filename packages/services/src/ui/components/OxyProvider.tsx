import React, { useCallback, useRef, useState, useEffect, useMemo, ReactNode } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Animated, StatusBar, Keyboard, KeyboardEvent } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OxyProviderProps as NavigationOxyProviderProps } from '../navigation/types'; // Renamed to avoid conflict
import { useOxy as useOxyContextHook } from '../context/OxyContext'; // Original context hook
import OxyRouter from '../navigation/OxyRouter';
import { FontLoader, setupFonts } from './FontLoader';
import { Toaster } from '../../lib/sonner';

// Import bottom sheet components directly
import { BottomSheetModal, BottomSheetBackdrop, BottomSheetBackdropProps, BottomSheetModalProvider, BottomSheetView, BottomSheetScrollView } from './bottomSheet';
import type { BottomSheetModalRef } from './bottomSheet';

// Redux imports
import { Provider as ReduxProvider } from 'react-redux';
import store from '../../store/store';
import { OxyServices, User } from '../../core';
import { initAuth, setOxyServices, Storage as ReduxStorage } from '../../store/slices/authSlice';
import { useAppDispatch, useAppSelector } // Assuming you'll create these custom hooks
from '../../hooks/reduxHooks';

// Initialize fonts automatically
setupFonts();

// Platform storage implementation for Redux
const webStorage: ReduxStorage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: (key: string) => localStorage.removeItem(key),
  clear: () => localStorage.clear(),
};

let asyncAppStorage: ReduxStorage | null = null;

const getReactNativeStorage = async (): Promise<ReduxStorage> => {
  if (!asyncAppStorage) {
    try {
      const AsyncStorageModule = await import('@react-native-async-storage/async-storage');
      const AsyncStorage = AsyncStorageModule.default;
      asyncAppStorage = {
        getItem: (key: string) => AsyncStorage.getItem(key),
        setItem: (key: string, value: string) => AsyncStorage.setItem(key, value),
        removeItem: (key: string) => AsyncStorage.removeItem(key),
        clear: () => AsyncStorage.clear(),
      };
    } catch (error) {
      console.error('Failed to import AsyncStorage for Redux:', error);
      return webStorage; // Fallback or throw
    }
  }
  return asyncAppStorage;
};

const isReactNative = (): boolean => {
  return typeof navigator !== 'undefined' && navigator.product === 'ReactNative';
};

// Props for the main OxyProvider component (Redux integrated)
export interface OxyProviderProps extends NavigationOxyProviderProps {
  children: ReactNode;
  oxyServices: OxyServices;
  storageKeyPrefix?: string;
  onAuthStateChange?: (user: User | null) => void;
  contextOnly?: boolean; // If true, only provides Redux store, no UI
  showInternalToaster?: boolean;
}

// Inner component to initialize Redux state and use hooks
const OxyAppInitializer: React.FC<Omit<OxyProviderProps, 'children'>> = ({
  oxyServices,
  storageKeyPrefix,
  onAuthStateChange,
  // bottomSheetRef is part of NavigationOxyProviderProps, will be passed to OxyBottomSheet
  ...bottomSheetProps // Spread the rest of the props (including initialScreen, etc.)
}) => {
  const dispatch = useAppDispatch();
  const reduxUser = useAppSelector(state => state.auth.user);

  useEffect(() => {
    dispatch(setOxyServices(oxyServices));

    const getStorage = async (): Promise<ReduxStorage> => {
      if (isReactNative()) {
        return getReactNativeStorage();
      }
      return webStorage;
    };

    getStorage().then(platformStorage => {
      dispatch(initAuth({ oxyServices, storage: platformStorage, storageKeyPrefix }));
    });
  }, [dispatch, oxyServices, storageKeyPrefix]);

  useEffect(() => {
    if (onAuthStateChange) {
      onAuthStateChange(reduxUser);
    }
  }, [reduxUser, onAuthStateChange]);

  // If contextOnly is true, we don't render the UI parts (BottomSheet)
  if (bottomSheetProps.contextOnly) {
    return null;
  }

  // Create internal bottom sheet ref for OxyBottomSheet
  const internalBottomSheetRef = useRef<BottomSheetModalRef>(null);

  // Pass the bottomSheetRef from props if it exists, otherwise use internal
  const effectiveBottomSheetRef = bottomSheetProps.bottomSheetRef || internalBottomSheetRef;


  return (
    <FontLoader>
      <GestureHandlerRootView style={styles.gestureHandlerRoot}>
        <BottomSheetModalProvider>
          <StatusBar translucent backgroundColor="transparent" />
          <SafeAreaProvider>
            <OxyBottomSheet
              {...bottomSheetProps}
              bottomSheetRef={effectiveBottomSheetRef}
              oxyServices={oxyServices}
            />
            {/* Global Toaster for app-wide notifications - this was outside children before */}
            {!bottomSheetProps.showInternalToaster && (
                <View style={styles.toasterContainer}>
                    <Toaster position="top-center" swipeToDismissDirection="left" offset={15} />
                </View>
            )}
          </SafeAreaProvider>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </FontLoader>
  );
};


const OxyProvider: React.FC<OxyProviderProps> = (props) => {
  const { children, contextOnly, ...initializerProps } = props;

  if (contextOnly) {
    // Only provide Redux store, no UI. Children are rendered directly.
    // Initializer will still run to setup Redux state.
    return (
      <ReduxProvider store={store}>
        <OxyAppInitializer {...initializerProps} contextOnly={true} />
        {children}
      </ReduxProvider>
    );
  }

  // Provide Redux store AND the UI (BottomSheet, etc.)
  return (
    <ReduxProvider store={store}>
      <OxyAppInitializer {...initializerProps} contextOnly={false} />
      {children}
    </ReduxProvider>
  );
};


/**
 * OxyBottomSheet component - A bottom sheet-based authentication and account management UI
 * This component now uses Redux state where appropriate but can also take direct props.
 * It's largely the same as before but will eventually be refactored to use Redux selectors/dispatch.
 */
const OxyBottomSheet: React.FC<NavigationOxyProviderProps> = ({
    oxyServices, // Can be sourced from Redux if not passed directly
    initialScreen = 'SignIn',
    onClose,
    onAuthenticated,
    theme = 'light',
    customStyles = {},
    bottomSheetRef, // This is the ref passed from OxyProvider/OxyAppInitializer
    autoPresent = false,
    showInternalToaster = true,
}) => {
    const modalRef = useRef<BottomSheetModalRef>(null);
    const navigationRef = useRef<((screen: string, props?: Record<string, any>) => void) | null>(null);
    const [contentHeight, setContentHeight] = useState<number>(0);
    const [containerWidth, setContainerWidth] = useState<number>(800);
    const screenHeight = Dimensions.get('window').height;

    // Effect to sync the passed bottomSheetRef with the internal modalRef
    useEffect(() => {
        if (bottomSheetRef && modalRef.current) {
            const methodsToExpose = ['snapToIndex', 'snapToPosition', 'close', 'expand', 'collapse', 'present', 'dismiss'];
            methodsToExpose.forEach((method) => {
                if (modalRef.current && typeof modalRef.current[method as keyof typeof modalRef.current] === 'function') {
                    // @ts-ignore
                    bottomSheetRef.current = bottomSheetRef.current || {};
                    // @ts-ignore
                    bottomSheetRef.current[method] = (...args: any[]) => modalRef.current?.[method]?.(...args);
                }
            });
            // @ts-ignore
            bottomSheetRef.current._navigateToScreen = (screenName: string, props?: Record<string, any>) => {
                if (navigationRef.current) {
                    navigationRef.current(screenName, props);
                } else if (typeof document !== 'undefined') {
                    const event = new CustomEvent('oxy:navigate', { detail: { screen: screenName, props } });
                    document.dispatchEvent(event);
                } else {
                    (globalThis as any).oxyNavigateEvent = { screen: screenName, props };
                }
            };
        }
    }, [bottomSheetRef, modalRef]);

    const [snapPoints, setSnapPoints] = useState<(string | number)[]>(['60%', '90%']);
    const fadeAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 1 : 0)).current;
    const slideAnim = useRef(new Animated.Value(Platform.OS === 'android' ? 0 : 50)).current;
    const handleScaleAnim = useRef(new Animated.Value(1)).current;
    const [keyboardVisible, setKeyboardVisible] = useState(false);
    const [keyboardHeight, setKeyboardHeight] = useState(0);
    const insets = useSafeAreaInsets();

    // NOTE: Instead of useOxyContextHook(), we would use useAppSelector for Redux state
    // const { user, isLoading, error, login, logout, signUp } = useAppSelector(state => state.auth);
    // const dispatch = useAppDispatch();
    // For now, we keep it simple and assume these are passed or handled internally by OxyRouter

    useEffect(() => {
        const keyboardWillShow = (event: KeyboardEvent) => {
            if (!keyboardVisible) {
                setKeyboardVisible(true);
                setKeyboardHeight(event.endCoordinates.height);
                requestAnimationFrame(() => modalRef.current?.snapToIndex(1));
            }
        };
        const keyboardWillHide = () => {
            if (keyboardVisible) {
                setKeyboardVisible(false);
                setKeyboardHeight(0);
            }
        };
        const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
        const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
        const showListener = Keyboard.addListener(showEvent, keyboardWillShow);
        const hideListener = Keyboard.addListener(hideEvent, keyboardWillHide);
        return () => {
            showListener.remove();
            hideListener.remove();
        };
    }, [keyboardVisible]);

    useEffect(() => {
        if (bottomSheetRef && modalRef.current) {
            // @ts-ignore
            bottomSheetRef.current.expand = () => {
                modalRef.current?.present();
                Animated.parallel([
                    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: Platform.OS === 'ios' }),
                    Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: Platform.OS === 'ios' }),
                ]).start();
            };
        }
        if (autoPresent && modalRef.current) {
            const timer = setTimeout(() => {
                modalRef.current?.present();
                Animated.parallel([
                    Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: Platform.OS === 'ios' }),
                    Animated.spring(slideAnim, { toValue: 0, friction: 8, tension: 40, useNativeDriver: Platform.OS === 'ios' }),
                ]).start();
            }, 100);
            return () => clearTimeout(timer);
        }
    }, [bottomSheetRef, modalRef, fadeAnim, slideAnim, autoPresent]);

    const handleAuthenticatedCB = useCallback((user: any) => {
        if (onAuthenticated) onAuthenticated(user);
    }, [onAuthenticated]);

    useEffect(() => {
        Animated.sequence([
            Animated.timing(handleScaleAnim, { toValue: 1.1, duration: 300, useNativeDriver: Platform.OS === 'ios' }),
            Animated.timing(handleScaleAnim, { toValue: 1, duration: 300, useNativeDriver: Platform.OS === 'ios' }),
        ]).start();
    }, [handleScaleAnim]);

    const renderBackdropCB = useCallback((props: BottomSheetBackdropProps) => (
        <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.5} />
    ), []);

    const backgroundStyleMemo = useMemo(() => ({
        backgroundColor: customStyles.backgroundColor || (theme === 'light' ? '#FFFFFF' : '#121212'),
        opacity: 1,
        ...(Platform.OS === 'android' && { elevation: 24 }),
    }), [customStyles.backgroundColor, theme]);

    const adjustSnapPointsCB = useCallback((points: string[]) => {
        if (keyboardVisible) {
            const highestPoint = points[points.length - 1];
            setSnapPoints([highestPoint, highestPoint]);
        } else if (contentHeight > 0) {
            const contentHeightPercent = Math.min(Math.ceil(contentHeight / screenHeight * 100), 90);
            const firstPoint = contentHeight / screenHeight > 0.6 ? `${contentHeightPercent}%` : points[0];
            setSnapPoints([firstPoint, points[1] || '90%']);
        } else {
            setSnapPoints(points);
        }
    }, [keyboardVisible, contentHeight, screenHeight]);

    const handleContentLayoutCB = useCallback((event: any) => {
        const { height: layoutHeight, width: layoutWidth } = event.nativeEvent.layout;
        setContentHeight(layoutHeight);
        setContainerWidth(layoutWidth);
        if (keyboardVisible) {
            const highestPoint = snapPoints[snapPoints.length - 1];
            setSnapPoints([highestPoint, highestPoint]);
        } else if (layoutHeight > 0) {
            const contentHeightPercent = Math.min(Math.ceil((layoutHeight + 40) / screenHeight * 100), 90);
            const firstPoint = layoutHeight / screenHeight > 0.6 ? `${contentHeightPercent}%` : snapPoints[0];
            setSnapPoints([firstPoint, snapPoints[1]]);
        }
    }, [keyboardVisible, screenHeight, snapPoints]);

    const handleCloseCB = useCallback(() => {
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: Platform.OS === 'android' ? 100 : 200,
            useNativeDriver: Platform.OS === 'ios',
        }).start(() => {
            modalRef.current?.dismiss();
            if (onClose) {
                setTimeout(onClose, Platform.OS === 'android' ? 150 : 100);
            }
        });
    }, [onClose, fadeAnim]);

    // Pass oxyServices from Redux store if available and not overridden by props
    const servicesFromStore = useAppSelector(state => state.auth.oxyServices);
    const finalOxyServices = oxyServices || servicesFromStore;

    if (!finalOxyServices) {
      // This can happen if services are not yet initialized in Redux store
      // and not passed as a prop. Render nothing or a loader.
      console.warn("OxyServices not available in OxyBottomSheet. Ensure it's initialized in Redux or passed as a prop.");
      return null;
    }


    return (
        <BottomSheetModal
            ref={modalRef}
            index={0}
            snapPoints={snapPoints}
            enablePanDownToClose
            backdropComponent={renderBackdropCB}
            backgroundStyle={[backgroundStyleMemo, styles.bottomSheetBackground]}
            handleIndicatorStyle={[styles.handleIndicator, { backgroundColor: customStyles.handleColor || (theme === 'light' ? '#CCCCCC' : '#444444')}]}
            // onChange={handleSheetChangesCB} // Define if needed
            style={styles.bottomSheetModalStyle}
            keyboardBehavior="interactive"
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
            enableOverDrag={true}
            enableContentPanningGesture={true}
            enableHandlePanningGesture={true}
            overDragResistanceFactor={2.5}
            enableBlurKeyboardOnGesture={true}
        >
            <BottomSheetScrollView
                style={[styles.contentContainerScrollView, customStyles.contentPadding !== undefined && { padding: customStyles.contentPadding }]}
                onLayout={handleContentLayoutCB}
            >
                <View style={styles.centeredContentWrapper}>
                    <Animated.View style={[styles.animatedContentContainer, Platform.OS === 'ios' && { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
                        <OxyRouter
                            oxyServices={finalOxyServices}
                            initialScreen={initialScreen}
                            onClose={handleCloseCB}
                            onAuthenticated={handleAuthenticatedCB}
                            theme={theme}
                            adjustSnapPoints={adjustSnapPointsCB}
                            navigationRef={navigationRef}
                            containerWidth={containerWidth}
                        />
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
    gestureHandlerRoot: { flex: 1, position: 'relative', backgroundColor: 'transparent', ...(Platform.OS === 'android' && { height: '100%', width: '100%' }) },
    bottomSheetModalStyle: { maxWidth: 800, width: '100%', marginHorizontal: 'auto' },
    bottomSheetBackground: { borderTopLeftRadius: 35, borderTopRightRadius: 35 },
    handleIndicator: { width: 40, height: 4 },
    contentContainerScrollView: { width: '100%', borderTopLeftRadius: 35, borderTopRightRadius: 35 },
    centeredContentWrapper: { width: '100%', marginHorizontal: 'auto' },
    animatedContentContainer: { width: '100%' },
    toasterContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, elevation: 9999, pointerEvents: 'box-none' },
    // Old styles that might be used or can be cleaned up:
    bottomSheetContainer: { maxWidth: 800, width: '100%', marginHorizontal: 'auto' },
    contentContainer: { width: '100%', borderTopLeftRadius: 35, borderTopRightRadius: 35 },
    animatedContent: { width: '100%' },
    indicator: { width: 40, height: 4, marginTop: 8, marginBottom: 8, borderRadius: 35 },
    errorContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

export default OxyProvider;
