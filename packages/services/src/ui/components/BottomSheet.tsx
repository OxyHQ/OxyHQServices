import React, { forwardRef, useMemo, useCallback, useImperativeHandle, useState, useEffect } from 'react';
import { View, StyleSheet, Keyboard, Platform } from 'react-native';
import {
    BottomSheetModal,
    BottomSheetBackdrop,
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
            enableOverDrag = false,
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
            const showSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
                (e) => setKeyboardHeight(e.endCoordinates.height)
            );
            const hideSubscription = Keyboard.addListener(
                Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
                () => setKeyboardHeight(0)
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

        // Calculate bottom padding for keyboard
        const bottomPadding = useMemo(
            () => insets.bottom + keyboardHeight,
            [insets.bottom, keyboardHeight],
        );

        // Clone children and inject padding if it's a BottomSheetScrollView
        const childrenWithPadding = useMemo(() => {
            return React.Children.map(children, (child) => {
                if (React.isValidElement(child)) {
                    // Inject bottom padding into the child's contentContainerStyle
                    return React.cloneElement(child as React.ReactElement<any>, {
                        contentContainerStyle: [
                            (child.props as any).contentContainerStyle,
                            { paddingBottom: bottomPadding },
                        ],
                    });
                }
                return child;
            });
        }, [children, bottomPadding]);

        return (
            <BottomSheetModal
                ref={bottomSheetModalRef}
                {...(snapPoints ? { snapPoints } : {})}
                enablePanDownToClose={enablePanDownToClose}
                enableDismissOnClose={enableDismissOnClose}
                onDismiss={onDismiss}
                onAnimate={onAnimate}
                index={index}
                keyboardBehavior={keyboardBehavior}
                keyboardBlurBehavior={keyboardBlurBehavior}
                android_keyboardInputMode={android_keyboardInputMode}
                backgroundComponent={renderBackground}
                backdropComponent={renderBackdrop}
                enableOverDrag={enableOverDrag}
                enableHandlePanningGesture={enableHandlePanningGesture}
                animateOnMount={animateOnMount}
                enableDynamicSizing={enableDynamicSizing}
                style={styles.container}
                handleStyle={[
                    { position: 'absolute', top: 0, left: 0, right: 0, height: 4 },
                    handleStyle,
                ]}
                handleIndicatorStyle={[
                    { backgroundColor: colors.border, width: 40, height: 4, borderRadius: 2 },
                    handleIndicatorStyle,
                ]}

            >
                {childrenWithPadding}
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
    },
});

export default BottomSheet;

