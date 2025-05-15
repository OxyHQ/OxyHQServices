import React, { useCallback, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Dimensions, Platform, Animated } from 'react-native';
import BottomSheet, { BottomSheetBackdrop, BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { OxyServices } from '../../core';
import { OxyProviderProps } from '../navigation/types';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import AccountCenterScreen from '../screens/AccountCenterScreen';
import { OxyContextProvider, useOxy } from '../context/OxyContext';
import OxyRouter from '../navigation/OxyRouter';

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
            <GestureHandlerRootView style={{ flex: 1 }}>
                <SafeAreaProvider>
                    <OxyBottomSheet {...bottomSheetProps} oxyServices={oxyServices} />
                    {children}
                </SafeAreaProvider>
            </GestureHandlerRootView>
        </OxyContextProvider>
    );
};

/**
 * OxyBottomSheet component - A bottom sheet-based authentication and account management UI
 * 
 * This is the original OxyProvider UI functionality, now extracted into its own component
 */
const OxyBottomSheet: React.FC<OxyProviderProps> = ({
    oxyServices,
    initialScreen = 'SignIn',
    onClose,
    onAuthenticated,
    theme = 'light',
    customStyles = {},
}) => {
    const bottomSheetRef = useRef<BottomSheet>(null);
    // Use fixed height values instead of percentages for more reliable sizing
    const [snapPoints, setSnapPoints] = useState<(string | number)[]>([height * 0.6, height * 0.85]);

    // Animation values
    const fadeAnim = useRef(new Animated.Value(1)).current;
    const slideAnim = useRef(new Animated.Value(0)).current;
    const handleScaleAnim = useRef(new Animated.Value(1)).current;

    // Get the authentication context
    const oxyContext = useOxy();

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
                useNativeDriver: true,
            }),
            Animated.timing(handleScaleAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }),
        ]);

        // Run the animation once when component mounts
        pulseAnimation.start();
    }, []);

    // Animate when sheet appears
    useEffect(() => {
        // Reset animation values
        slideAnim.setValue(50);
        fadeAnim.setValue(0);

        // Start animations
        Animated.parallel([
            Animated.timing(fadeAnim, {
                toValue: 1,
                duration: 300,
                useNativeDriver: true,
            }),
            Animated.spring(slideAnim, {
                toValue: 0,
                friction: 8,
                tension: 40,
                useNativeDriver: true,
            }),
        ]).start();
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
            opacity: 1
        };
    };

    // Method to adjust snap points from Router
    const adjustSnapPoints = useCallback((points: string[]) => {
        // Convert percentage strings to numeric values
        const convertedPoints = points.map(point => {
            if (typeof point === 'string' && point.includes('%')) {
                const percentage = parseInt(point, 10) / 100;
                return height * percentage;
            }
            return point;
        });

        setSnapPoints(convertedPoints);
    }, [height]);

    // Close the bottom sheet with animation
    const handleClose = useCallback(() => {
        // Animate content out
        Animated.timing(fadeAnim, {
            toValue: 0,
            duration: 200,
            useNativeDriver: true,
        }).start(() => {
            // Close the sheet
            bottomSheetRef.current?.close();
            if (onClose) {
                setTimeout(() => {
                    onClose();
                }, 100);
            }
        });
    }, [onClose, fadeAnim]);

    return (
        <BottomSheet
            style={[
                { width: '100%', height: '100%' },
                styles.bottomSheet
            ]}
            ref={bottomSheetRef}
            index={0}
            snapPoints={snapPoints}
            enablePanDownToClose
            backdropComponent={renderBackdrop}
            handleComponent={() => (
                <Animated.View
                    style={{
                        alignItems: 'center',
                        paddingVertical: 8,
                        transform: [{ scale: handleScaleAnim }]
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
                    borderTopLeftRadius: 15,
                    borderTopRightRadius: 15,
                }
            ]}
            onChange={(index) => {
                if (index === -1 && onClose) {
                    onClose();
                } else if (index === 1) {
                    // Pulse animation when expanded to full height
                    Animated.sequence([
                        Animated.timing(handleScaleAnim, {
                            toValue: 1.2,
                            duration: 200,
                            useNativeDriver: true,
                        }),
                        Animated.timing(handleScaleAnim, {
                            toValue: 1,
                            duration: 200,
                            useNativeDriver: true,
                        }),
                    ]).start();
                }
            }}
            // Adding additional props to improve layout behavior
            keyboardBehavior={Platform.OS === 'ios' ? 'interactive' : 'extend'}
            keyboardBlurBehavior="restore"
            android_keyboardInputMode="adjustResize"
        >
            <Animated.View
                style={[
                    styles.contentContainer,
                    // Override padding if provided in customStyles
                    customStyles.contentPadding !== undefined && { padding: customStyles.contentPadding },
                    // Apply animations
                    {
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
        </BottomSheet>
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
    indicator: {
        width: 40,
        height: 4,
        alignSelf: 'center',
        marginTop: 8,
        marginBottom: 8,
        borderRadius: 2,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    bottomSheet: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.2,
        shadowRadius: 5,
        elevation: 16,
    },
});

export default OxyProvider;
