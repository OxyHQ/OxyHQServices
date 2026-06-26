import { type FC, useMemo } from 'react';

import {
    BlurMask,
    Canvas,
    Circle,
    Group,
    interpolate,
    LinearGradient,
    Mask,
    Path,
    Rect,
    RoundedRect,
    Skia,
} from '@shopify/react-native-skia';
import {
    Extrapolation,
    useDerivedValue,
} from 'react-native-reanimated';

// Device tilt removed - hologram only responds to card rotation

import type { SharedValue } from 'react-native-reanimated';

/**
 * Props for the HolographicCard component
 * @typedef {Object} HolographicCardProps
 * @property {number} width - The width of the card
 * @property {number} height - The height of the card
 * @property {SharedValue<number>} rotateY - Animated rotation value around Y axis (flip)
 * @property {SharedValue<number>} [rotateX] - Animated rotation value around X axis (3D pitch)
 * @property {SharedValue<number>} [rotateZ] - Animated rotation value around Z axis (3D roll)
 * @property {string} [color='#FFF'] - Background color of the card
 */
interface HolographicCardProps {
    width: number;
    height: number;
    rotateY: SharedValue<number>;
    rotateX?: SharedValue<number>;
    rotateZ?: SharedValue<number>;
    pressX?: SharedValue<number>;
    pressY?: SharedValue<number>;
    isPressed?: SharedValue<number>;
    color?: string;
}

export const HolographicCard: FC<HolographicCardProps> = ({
    width,
    height,
    rotateY,
    rotateX,
    rotateZ,
    pressX,
    pressY,
    isPressed,
    color = '#FFF',
}) => {
    // Calculate mask center based on card's 3D rotation (flip + 3D tilt) AND press position
    const maskCenterX = useDerivedValue(() => {
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        // Base position from card flip rotation
        const baseX =
            width / 2 - Math.sin((rotation * Math.PI) / 180) * (width / 2);

        // Add 3D rotation influence (rotateZ affects X position)
        const tilt3DX = rotateZ ? (rotateZ.value / 15) * (width / 3) : 0; // Normalize by max rotation (15°)

        // Add press position influence
        const pressInfluence = isPressed?.value ?? 0;
        const pressOffsetX = pressX
            ? (pressX.value - width / 2) * pressInfluence * 0.4
            : 0;

        return baseX + tilt3DX + pressOffsetX;
    });

    const maskCenterY = useDerivedValue(() => {
        // Base Y position
        const baseY = height / 2;

        // Add 3D rotation influence (rotateX affects Y position)
        const tilt3DY = rotateX ? (rotateX.value / 15) * (height / 3) : 0; // Normalize by max rotation (15°)

        // Add press position influence
        const pressInfluence = isPressed?.value ?? 0;
        const pressOffsetY = pressY
            ? (pressY.value - height / 2) * pressInfluence * 0.4
            : 0;

        return baseY + tilt3DY + pressOffsetY;
    });

    // Calculate 3D lighting position based on card rotation and press (simulates light reflection)
    const lightingX = useDerivedValue(() => {
        // Base lighting from card rotation (simulates 3D lighting)
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        // Simulate light coming from top-left (like real cards)
        const lightAngle = (rotation * Math.PI) / 180;
        const baseX = width * 0.2 + Math.sin(lightAngle) * width * 0.3;

        // 3D rotation influence on lighting position
        const tilt3DX = rotateZ ? (rotateZ.value / 15) * width * 0.2 : 0;

        // Press creates a highlight at press position (like light reflection on metal)
        const pressInfluence = isPressed?.value ?? 0;
        const pressOffsetX = pressX ? (pressX.value - width / 2) * pressInfluence * 0.5 : 0;

        return baseX + tilt3DX + pressOffsetX;
    });

    const lightingY = useDerivedValue(() => {
        // Base lighting from card rotation
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        const lightAngle = (rotation * Math.PI) / 180;
        const baseY = height * 0.2 + Math.cos(lightAngle) * height * 0.3;

        // 3D rotation influence
        const tilt3DY = rotateX ? (rotateX.value / 15) * height * 0.2 : 0;

        // Press creates a highlight at press position
        const pressInfluence = isPressed?.value ?? 0;
        const pressOffsetY = pressY ? (pressY.value - height / 2) * pressInfluence * 0.5 : 0;

        return baseY + tilt3DY + pressOffsetY;
    });

    // Calculate lighting intensity/brightness (reduced for subtle effect)
    const lightingIntensity = useDerivedValue(() => {
        // Base intensity - very subtle
        const baseIntensity = 0.08;

        // Press creates brightness boost (like light reflection)
        const pressBoost = isPressed?.value ?? 0;
        const pressIntensity = pressBoost * 0.15;

        // Add gyroscope influence for 3D effect
        const gyroInfluence = rotateX && rotateZ
            ? (Math.abs(rotateX.value) + Math.abs(rotateZ.value)) / 30 * 0.1
            : 0;

        return Math.min(baseIntensity + pressIntensity + gyroInfluence, 0.25);
    });

    // Calculate mask opacity - always show hologram with base opacity
    const maskOpacity = useDerivedValue(() => {
        // Base opacity - always show hologram even when card is normal (like real metal cards)
        const baseOpacity = 0.35; // Visible at normal state

        // Rotation-based variation (peaks at certain angles)
        const rotationVariation = interpolate(
            Math.abs(rotateY.value),
            [0, 90, 180, 270, 360],
            [0, 0.3, 0, 0.3, 0],
            Extrapolation.CLAMP,
        );

        // Gyroscope 3D rotation influence - hologram becomes more visible when tilted
        const gyroVariation = rotateX && rotateZ
            ? (Math.abs(rotateX.value) + Math.abs(rotateZ.value)) / 30 * 0.2
            : 0;

        // Press boost - increase opacity when pressed (like real cards get brighter)
        const pressBoost = isPressed?.value ?? 0;
        const pressOpacity = pressBoost * 0.15; // More visible when pressed

        return Math.min(baseOpacity + rotationVariation + gyroVariation + pressOpacity, 0.8);
    });

    // Mask radius constant
    const maskRadius = Math.max(width, height) * 0.7;

    // No cutouts - full card coverage

    // Calculate grid dimensions for the pattern
    const LogoAmountHorizontal = 25;
    const LogoSize = width / LogoAmountHorizontal;
    const LogoAmountVertical = Math.round(height / LogoSize) + 1;

    // Create the grid pattern of circles
    const GridPath = useMemo(() => {
        const skPath = Skia.Path.Make();
        for (let i = 0; i < LogoAmountHorizontal; i++) {
            for (let j = 0; j < LogoAmountVertical; j++) {
                skPath.addCircle(
                    LogoSize / 2 + i * LogoSize,
                    LogoSize / 2 + j * LogoSize,
                    LogoSize / 2,
                );
            }
        }
        return skPath;
    }, [LogoAmountVertical, LogoSize]);

    // Gradient positions influenced by card's 3D rotation (flip + 3D tilt) AND press position
    const gradientStart = useDerivedValue(() => {
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        // Flip rotation influence on gradient
        const rotationX = Math.sin((rotation * Math.PI) / 180) * width * 0.3;
        const rotationY = Math.cos((rotation * Math.PI) / 180) * height * 0.3;

        // 3D rotation influence (enhanced for gyroscope)
        const tilt3DX = rotateZ ? (rotateZ.value / 15) * width * 0.25 : 0;
        const tilt3DY = rotateX ? (rotateX.value / 15) * height * 0.25 : 0;

        // Press position influence
        const pressInfluence = isPressed?.value ?? 0;
        const pressOffsetX = pressX ? (pressX.value - width / 2) * pressInfluence * 0.2 : 0;
        const pressOffsetY = pressY ? (pressY.value - height / 2) * pressInfluence * 0.2 : 0;

        // Add 3D perspective offset for depth effect (calculated directly here)
        const rotateXValue = rotateX ? rotateX.value : 0;
        const rotateZValue = rotateZ ? rotateZ.value : 0;
        const rotateXRad = (rotateXValue * Math.PI) / 180;
        const rotateZRad = (rotateZValue * Math.PI) / 180;
        const perspectiveX = Math.sin(rotateZRad) * width * 0.15; // Horizontal perspective shift
        const perspectiveY = Math.sin(rotateXRad) * height * 0.15; // Vertical perspective shift

        return {
            x: width * 0.1 + rotationX + tilt3DX + pressOffsetX + perspectiveX,
            y: height * 0.1 + rotationY + tilt3DY + pressOffsetY + perspectiveY
        };
    });

    const gradientEnd = useDerivedValue(() => {
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        // Flip rotation influence on gradient (opposite direction)
        const rotationX = -Math.sin((rotation * Math.PI) / 180) * width * 0.3;
        const rotationY = -Math.cos((rotation * Math.PI) / 180) * height * 0.3;

        // 3D rotation influence (opposite direction, enhanced for gyroscope)
        const tilt3DX = rotateZ ? -(rotateZ.value / 15) * width * 0.25 : 0;
        const tilt3DY = rotateX ? -(rotateX.value / 15) * height * 0.25 : 0;

        // Press position influence (opposite direction for gradient)
        const pressInfluence = isPressed?.value ?? 0;
        const pressOffsetX = pressX ? -(pressX.value - width / 2) * pressInfluence * 0.2 : 0;
        const pressOffsetY = pressY ? -(pressY.value - height / 2) * pressInfluence * 0.2 : 0;

        // Add 3D perspective offset for depth effect (calculated directly here, opposite direction)
        const rotateXValue = rotateX ? rotateX.value : 0;
        const rotateZValue = rotateZ ? rotateZ.value : 0;
        const rotateXRad = (rotateXValue * Math.PI) / 180;
        const rotateZRad = (rotateZValue * Math.PI) / 180;
        const perspectiveX = -Math.sin(rotateZRad) * width * 0.15; // Horizontal perspective shift (opposite)
        const perspectiveY = -Math.sin(rotateXRad) * height * 0.15; // Vertical perspective shift (opposite)

        return {
            x: width * 0.9 + rotationX + tilt3DX + pressOffsetX + perspectiveX,
            y: height * 0.9 + rotationY + tilt3DY + pressOffsetY + perspectiveY
        };
    });


    return (
        <Canvas style={{ width, height, backgroundColor: 'transparent' }}>
            <Group>
                {/* Main card background */}
                <RoundedRect
                    x={0}
                    y={0}
                    width={width}
                    height={height}
                    color={color || '#FFFFFF'}
                    r={24}
                />
                <Group>
                    {/* Holographic effect mask */}
                    <Mask
                        mode="luminance"
                        mask={
                            <Group>
                                <Rect
                                    x={0}
                                    y={0}
                                    width={width}
                                    height={height}
                                    color={'white'}
                                    opacity={maskOpacity}
                                />
                                <Group>
                                    <Circle
                                        cx={maskCenterX}
                                        cy={maskCenterY}
                                        r={maskRadius}
                                        color={'rgba(0,0,0,0.5)'}>
                                        <BlurMask blur={15} style="normal" />
                                    </Circle>
                                </Group>
                            </Group>
                        }>
                        <Group>
                            <Path path={GridPath}>
                                {/* Holographic gradient with 3D lighting/brightness effect */}
                                <LinearGradient
                                    start={gradientStart}
                                    end={gradientEnd}
                                    colors={[
                                        'rgba(52,168,82,1)',   // Green
                                        'rgba(255,211,20,1)',  // Yellow
                                        'rgba(255,70,65,1)',   // Red
                                        'rgba(49,134,255,1)',  // Blue
                                        'rgba(49,134,255,0.5)', // Blue (faded)
                                        'rgba(52,168,82,1)',   // Green (back to start)
                                    ]}
                                    positions={[0, 0.17, 0.33, 0.5, 0.67, 1]}
                                />
                            </Path>
                        </Group>
                        {/* 3D lighting overlay - very subtle, only visible when pressed/tilted */}
                        <Group opacity={lightingIntensity}>
                            <Circle
                                cx={lightingX}
                                cy={lightingY}
                                r={Math.max(width, height) * 0.35}
                            >
                                <LinearGradient
                                    start={useDerivedValue(() => ({
                                        x: lightingX.value - Math.max(width, height) * 0.15,
                                        y: lightingY.value - Math.max(width, height) * 0.15
                                    }))}
                                    end={useDerivedValue(() => ({
                                        x: lightingX.value + Math.max(width, height) * 0.15,
                                        y: lightingY.value + Math.max(width, height) * 0.15
                                    }))}
                                    colors={[
                                        'rgba(255,255,255,0.15)',
                                        'rgba(255,255,255,0.08)',
                                        'rgba(255,255,255,0)',
                                    ]}
                                    positions={[0, 0.4, 1]}
                                />
                            </Circle>
                        </Group>
                    </Mask>
                </Group>
            </Group>
        </Canvas>
    );
};