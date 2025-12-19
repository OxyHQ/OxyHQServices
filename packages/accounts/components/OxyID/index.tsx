/**
 * A flippable ID card component that supports tap gesture to toggle between front and back.
 * The card has two sides (front and back) and uses a holographic effect that responds to device tilt.
 */

import { StyleSheet } from 'react-native';

import { type FC, memo, type ReactNode } from 'react';

import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
    useAnimatedStyle,
    useDerivedValue,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { HolographicCard } from '../holographic-card';
import { useDeviceTilt } from '../../hooks/use-device-tilt';

/**
 * Props for the Ticket component
 * @typedef {Object} TicketProps
 * @property {number} width - The width of the ticket
 * @property {number} height - The height of the ticket
 * @property {ReactNode} [frontSide] - Content to display on the front of the ticket
 * @property {ReactNode} [backSide] - Content to display on the back of the ticket
 */
type TicketProps = {
    width: number;
    height: number;
    frontSide?: ReactNode;
    backSide?: ReactNode;
};

export const Ticket: FC<TicketProps> = memo(
    ({ width, height, frontSide, backSide }) => {
        // Get device gyroscope rotation for 3D card movement (Airbnb-style)
        const { rotateX: deviceRotateX, rotateY: deviceRotateY } = useDeviceTilt();

        // Shared value for rotation (0 = front, 180 = back)
        const rotation = useSharedValue(0);

        // Shared values for press tilt effect
        const pressRotateX = useSharedValue(0);
        const pressRotateZ = useSharedValue(0);
        const pressTranslateY = useSharedValue(0);

        // Shared values for press position (for hologram effect)
        const pressX = useSharedValue(width / 2);
        const pressY = useSharedValue(height / 2);
        const isPressed = useSharedValue(0);

        // Derived value for Y-axis rotation
        const rotateY = useDerivedValue(() => {
            return rotation.value;
        });

        // Press gesture handler for tilt effect (using Pan with minDistance 0 to detect any touch)
        const pressGesture = Gesture.Pan()
            .minDistance(0)
            .maxPointers(1)
            .hitSlop({ top: 50, bottom: 50, left: 50, right: 50 })
            .onBegin((event) => {
                'worklet';
                // Store press position for hologram effect
                pressX.value = event.x;
                pressY.value = event.y;
                isPressed.value = 1;

                // Calculate tilt based on press position relative to card center
                const centerY = height / 2;

                // Normalize Y position (-1 to 1) relative to center
                const normalizedY = (event.y - centerY) / centerY;

                // Calculate tilt angles based on press position (only X rotation for realistic feel)
                // Pressing top tilts forward (positive rotateX), bottom tilts backward (negative rotateX)
                const maxTilt = 6; // Subtle tilt like metal card (stiffer)

                pressRotateX.value = withTiming(-normalizedY * maxTilt, { duration: 80 });
                pressRotateZ.value = 0; // No Z rotation for realistic press feel
                // No scale - keep card at full size
                pressTranslateY.value = withTiming(5, { duration: 80 }); // Push down more (like pressing metal)
            })
            .onUpdate((event) => {
                'worklet';
                // Update press position for hologram
                pressX.value = event.x;
                pressY.value = event.y;

                // Update tilt as finger moves
                const centerY = height / 2;

                const normalizedY = (event.y - centerY) / centerY;

                const maxTilt = 6;

                pressRotateX.value = -normalizedY * maxTilt;
                pressRotateZ.value = 0; // No Z rotation for realistic press feel
            })
            .onEnd(() => {
                'worklet';
                isPressed.value = 0;
                // Return to normal when released (stiff spring like metal)
                pressRotateX.value = withSpring(0, { dampingRatio: 3 });
                pressRotateZ.value = withSpring(0, { dampingRatio: 3 });
                // No scale - keep card at full size
                pressTranslateY.value = withSpring(0, { dampingRatio: 3 });
            })
            .onFinalize(() => {
                'worklet';
                isPressed.value = 0;
                // Ensure it returns to normal (stiff spring like metal)
                pressRotateX.value = withSpring(0, { dampingRatio: 3 });
                pressRotateZ.value = withSpring(0, { dampingRatio: 3 });
                // No scale - keep card at full size
                pressTranslateY.value = withSpring(0, { dampingRatio: 3 });
            });

        // Tap gesture handler for toggling between front and back
        const tapGesture = Gesture.Tap()
            .hitSlop({ top: 50, bottom: 50, left: 50, right: 50 })
            .onEnd(() => {
                scheduleOnRN(Haptics.selectionAsync);
                // Toggle between 0 (front) and 180 (back)
                rotation.value = withSpring(rotation.value === 0 ? 180 : 0, {
                    dampingRatio: 1.5,
                    duration: 500,
                });
            });

        // Combine press and tap gestures - both can work simultaneously
        const gesture = Gesture.Simultaneous(pressGesture, tapGesture);

        // Derived values for combined 3D rotation (for hologram)
        const combinedRotateX = useDerivedValue(() => pressRotateX.value + deviceRotateX.value);
        const combinedRotateZ = useDerivedValue(() => pressRotateZ.value + deviceRotateY.value);

        const rTicketStyle = useAnimatedStyle(() => {
            // Combine device gyroscope rotation (3D movement) with press tilt and flip rotation
            // Device rotation is already in degrees with limits applied
            const rotateYValue = `${rotateY.value}deg`; // Flip rotation (0 or 180)
            const rotateXValue = `${combinedRotateX.value}deg`; // X rotation (pitch)
            const rotateZValue = `${combinedRotateZ.value}deg`; // Z rotation (roll) - using deviceRotateY for left/right

            return {
                transform: [
                    { perspective: 1000 },
                    { translateY: pressTranslateY.value },
                    // No scale - keep card at full size
                    { rotateY: rotateYValue }, // Flip rotation
                    { rotateX: rotateXValue }, // 3D pitch + press
                    { rotateZ: rotateZValue }, // 3D roll + press (no Z from press, so just device)
                ],
            };
        });

        // Determine which side is currently visible
        const isFront = useDerivedValue(() => {
            const absRotate = Math.abs(rotateY.value);
            return absRotate < 90 || absRotate > 270;
        });

        const rFrontStyle = useAnimatedStyle(() => {
            return {
                opacity: isFront.value ? 1 : 0,
                zIndex: isFront.value ? 1 : 0,
            };
        });

        const rBackStyle = useAnimatedStyle(() => {
            return {
                opacity: isFront.value ? 0 : 1,
                zIndex: isFront.value ? 0 : 1,
            };
        });

        return (
            <GestureDetector gesture={gesture}>
                <Animated.View
                    style={[
                        {
                            width,
                            height,
                            overflow: 'hidden',
                            borderRadius: 24,
                        },
                        rTicketStyle,
                    ]}>
                    {/* Holographic effect layer */}
                    <HolographicCard
                        width={width}
                        height={height}
                        rotateY={rotateY}
                        rotateX={combinedRotateX}
                        rotateZ={combinedRotateZ}
                        color="#FFFFFF"
                    />
                    {/* Front side content */}
                    <Animated.View style={[StyleSheet.absoluteFill, rFrontStyle]}>
                        {frontSide}
                    </Animated.View>
                    {/* Back side content (mirrored with scaleX: -1) */}
                    <Animated.View
                        style={[
                            StyleSheet.absoluteFill,
                            {
                                transform: [{ scaleX: -1 }],
                            },
                            rBackStyle,
                        ]}>
                        {backSide}
                    </Animated.View>
                </Animated.View>
            </GestureDetector>
        );
    },
);

Ticket.displayName = 'Ticket';