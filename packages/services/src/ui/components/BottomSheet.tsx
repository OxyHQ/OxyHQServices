import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;



import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

container: {
    maxWidth: 800,
        alignSelf: 'center',
            width: '100%',
    },
const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        alignSelf: 'center',
        width: '100%',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    overflow: 'hidden',
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        alignSelf: 'center',
        width: '100%',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    overflow: 'hidden',
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        alignSelf: 'center',
        width: '100%',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    overflow: 'hidden',
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                style={styles.container}
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        alignSelf: 'center',
        width: '100%',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        alignSelf: 'center',
        width: '100%',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundStyle={sheetBackgroundStyle}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Custom background component with rounded corners
        const renderBackground = useCallback(
            (props: any) => (
                <View
                    {...props}
                    style={[
                        styles.background,
                        { backgroundColor: colors.background },
                        props.style,
                        backgroundStyle,
                    ]}
                />
            ),
            [colors, backgroundStyle],
        );


        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundComponent={renderBackground}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        width: '100%',
        alignSelf: 'center',
        marginHorizontal: 'auto',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
        overflow: 'hidden',
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Custom background component with rounded corners
        const renderBackground = useCallback(
            (props: any) => (
                <View
                    {...props}
                    style={[
                        styles.background,
                        { backgroundColor: colors.background },
                        props.style,
                        backgroundStyle,
                    ]}
                />
            ),
            [colors, backgroundStyle],
        );


        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundComponent={renderBackground}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        width: '100%',
        alignSelf: 'center',
        marginHorizontal: 'auto',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
        overflow: 'hidden',
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;


import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetView,
    BottomSheetBackdrop,
    BottomSheetHandle,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColorScheme } from '../hooks/use-color-scheme';
import { Colors } from '../constants/theme';

export interface BottomSheetRef {
    present: () => void;
    dismiss: () => void;
    close: () => void;
    snapToIndex: (index: number) => void;
    expand: () => void;
    collapse: () => void;
}

export interface BottomSheetProps {
    children: React.ReactNode;
    snapPoints?: (string | number)[];
    enablePanDownToClose?: boolean;
    enableDismissOnClose?: boolean;
    onDismiss?: () => void;
    onAnimate?: (fromIndex: number, toIndex: number) => void;
    index?: number;
    enableDynamicSizing?: boolean;
    keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
    keyboardBlurBehavior?: 'none' | 'restore';
    android_keyboardInputMode?: 'adjustResize' | 'adjustPan';
    backgroundStyle?: object;
    handleStyle?: object;
    handleIndicatorStyle?: object;
    enableOverDrag?: boolean;
    enableHandlePanningGesture?: boolean;
    animateOnMount?: boolean;
}

const BottomSheet = forwardRef<BottomSheetRef, BottomSheetProps>(
    (
        {
            children,
            snapPoints: providedSnapPoints,
            enablePanDownToClose = true,
            enableDismissOnClose = true,
            onDismiss,
            onAnimate,
            index = 0,
            enableDynamicSizing = false,
            keyboardBehavior = 'interactive',
            keyboardBlurBehavior = 'restore',
            android_keyboardInputMode = 'adjustResize',
            backgroundStyle,
            handleStyle,
            handleIndicatorStyle,
            enableOverDrag = true,
            enableHandlePanningGesture = true,
            animateOnMount = true,
        },
        ref,
    ) => {
        const colorScheme = useColorScheme();
        const insets = useSafeAreaInsets();
        const colors = useMemo(() => Colors[colorScheme ?? 'light'], [colorScheme]);

        // Track keyboard height for padding calculation
        const [keyboardHeight, setKeyboardHeight] = useState(0);

        // Listen to keyboard show/hide events
        useEffect(() => {
            // Use keyboardDidShow/keyboardDidHide for better accuracy
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => {
                    setKeyboardHeight(e.endCoordinates.height);
                }
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => {
                    setKeyboardHeight(0);
                }
            );

            return () => {
                showSubscription.remove();
                hideSubscription.remove();
            };
        }, []);

        // Default snap points if not provided
        const defaultSnapPoints = useMemo(() => ['25%', '50%', '90%'], []);

        // Use dynamic sizing if enabled, otherwise use provided or default snap points
        // When enableDynamicSizing is true, don't pass snapPoints (let it size to content)
        const snapPoints = useMemo(() => {
            if (enableDynamicSizing) {
                // For dynamic sizing, return undefined to let the sheet size to content
                return undefined;
            }
            return providedSnapPoints || defaultSnapPoints;
        }, [enableDynamicSizing, providedSnapPoints, defaultSnapPoints]);

        const bottomSheetModalRef = React.useRef<BottomSheetModal>(null);

        // Expose methods via ref
        useImperativeHandle(ref, () => ({
            present: () => {
                bottomSheetModalRef.current?.present();
            },
            dismiss: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            close: () => {
                bottomSheetModalRef.current?.dismiss();
            },
            snapToIndex: (idx: number) => {
                bottomSheetModalRef.current?.snapToIndex(idx);
            },
            expand: () => {
                bottomSheetModalRef.current?.expand();
            },
            collapse: () => {
                bottomSheetModalRef.current?.collapse();
            },
        }));

        const handleDismiss = useCallback(() => {
            onDismiss?.();
        }, [onDismiss]);

        const handleAnimate = useCallback(
            (fromIndex: number, toIndex: number) => {
                onAnimate?.(fromIndex, toIndex);
            },
            [onAnimate],
        );

        // Backdrop component
        const renderBackdrop = useCallback(
            (props: any) => (
                <BottomSheetBackdrop
                    {...props}
                    disappearsOnIndex={-1}
                    appearsOnIndex={0}
                    opacity={0.5}
                    enableTouchThrough={false}
                />
            ),
            [],
        );

        // Custom background component with rounded corners
        const renderBackground = useCallback(
            (props: any) => (
                <View
                    {...props}
                    style={[
                        styles.background,
                        { backgroundColor: colors.background },
                        props.style,
                        backgroundStyle,
                    ]}
                />
            ),
            [colors, backgroundStyle],
        );


        // Handle component
        const renderHandle = useCallback(
            (props: any) => (
                <BottomSheetHandle
                    {...props}
                    style={[
                        styles.handle,
                        { backgroundColor: colors.background },
                        handleStyle,
                    ]}
                    indicatorStyle={[
                        styles.handleIndicator,
                        { backgroundColor: colors.border },
                        handleIndicatorStyle,
                    ]}
                />
            ),
            [colors, handleStyle, handleIndicatorStyle],
        );

        // Background style
        const sheetBackgroundStyle = useMemo(
            () => [
                styles.background,
                { backgroundColor: colors.background },
                backgroundStyle,
            ],
            [colors, backgroundStyle],
        );

        // Content container style with safe area insets and keyboard height
        const contentContainerStyle = useMemo(
            () => [
                styles.contentContainer,
                {
                    paddingBottom: Math.max(insets.bottom, 16) + keyboardHeight,
                },
            ],
            [insets.bottom, keyboardHeight],
        );

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={handleDismiss}
                onAnimate={handleAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundComponent={renderBackground}
                handleComponent={renderHandle}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
            >
                <BottomSheetView style={contentContainerStyle}>
                    {children}
                </BottomSheetView>
            </BottomSheetModal>
        );
    },
);

BottomSheet.displayName = 'BottomSheet';

const styles = StyleSheet.create({
    container: {
        maxWidth: 800,
        width: '100%',
        alignSelf: 'center',
        marginHorizontal: 'auto',
    },
    background: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        overflow: 'hidden',
        overflow: 'hidden',
    },
    handle: {
        paddingTop: 8,
        paddingBottom: 4,
    },
    handleIndicator: {
        width: 40,
        height: 4,
        borderRadius: 2,
    },
    contentContainer: {
        flex: 1,
        paddingHorizontal: 16,
    },
});

export default BottomSheet;

