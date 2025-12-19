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
    color?: string;
}

export const HolographicCard: FC<HolographicCardProps> = ({
    width,
    height,
    rotateY,
    rotateX,
    rotateZ,
    color = '#FFF',
}) => {
    // Calculate mask center based on card's 3D rotation (flip + 3D tilt)
    const maskCenterX = useDerivedValue(() => {
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        // Base position from card flip rotation
        const baseX =
            width / 2 - Math.sin((rotation * Math.PI) / 180) * (width / 2);

        // Add 3D rotation influence (rotateZ affects X position)
        const tilt3DX = rotateZ ? (rotateZ.value / 15) * (width / 3) : 0; // Normalize by max rotation (15°)

        return baseX + tilt3DX;
    });

    const maskCenterY = useDerivedValue(() => {
        // Base Y position
        const baseY = height / 2;

        // Add 3D rotation influence (rotateX affects Y position)
        const tilt3DY = rotateX ? (rotateX.value / 15) * (height / 3) : 0; // Normalize by max rotation (15°)

        return baseY + tilt3DY;
    });

    // Calculate mask opacity - always show hologram with base opacity
    const maskOpacity = useDerivedValue(() => {
        // Base opacity - always show hologram (like real metal cards)
        const baseOpacity = 0.5;

        // Rotation-based variation (peaks at certain angles)
        const rotationVariation = interpolate(
            Math.abs(rotateY.value),
            [0, 90, 180, 270, 360],
            [0, 0.4, 0, 0.4, 0],
            Extrapolation.CLAMP,
        );

        return Math.min(baseOpacity + rotationVariation, 0.9);
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

    // Gradient positions influenced by card's 3D rotation (flip + 3D tilt)
    const gradientStart = useDerivedValue(() => {
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        // Flip rotation influence on gradient
        const rotationX = Math.sin((rotation * Math.PI) / 180) * width * 0.3;
        const rotationY = Math.cos((rotation * Math.PI) / 180) * height * 0.3;

        // 3D rotation influence
        const tilt3DX = rotateZ ? (rotateZ.value / 15) * width * 0.2 : 0;
        const tilt3DY = rotateX ? (rotateX.value / 15) * height * 0.2 : 0;

        return {
            x: width * 0.1 + rotationX + tilt3DX,
            y: height * 0.1 + rotationY + tilt3DY
        };
    });

    const gradientEnd = useDerivedValue(() => {
        const normalizedRotation = rotateY.value % 360;
        const rotation =
            normalizedRotation < 0 ? normalizedRotation + 360 : normalizedRotation;

        // Flip rotation influence on gradient (opposite direction)
        const rotationX = -Math.sin((rotation * Math.PI) / 180) * width * 0.3;
        const rotationY = -Math.cos((rotation * Math.PI) / 180) * height * 0.3;

        // 3D rotation influence (opposite direction)
        const tilt3DX = rotateZ ? -(rotateZ.value / 15) * width * 0.2 : 0;
        const tilt3DY = rotateX ? -(rotateX.value / 15) * height * 0.2 : 0;

        return {
            x: width * 0.9 + rotationX + tilt3DX,
            y: height * 0.9 + rotationY + tilt3DY
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
                    color={color}
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
                                <Circle
                                    cx={maskCenterX}
                                    cy={maskCenterY}
                                    r={maskRadius}
                                    color={'rgba(0,0,0,1)'}>
                                    <BlurMask blur={180} style="normal" />
                                </Circle>
                            </Group>
                        }>
                        <Path path={GridPath}>
                            {/* Holographic gradient colors from id-card.tsx - responds to device tilt */}
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
                    </Mask>
                </Group>
            </Group>
        </Canvas>
    );
};