/**
 * Float shadow for the Oxy ID card.
 *
 * Rendered as a sibling BEHIND the card inside the un-clipped outer wrapper, so
 * the blurred shadow can spill past the card's rounded-rect clip. It stays flat
 * on the "ground" to sell the card floating above the surface.
 *
 * IMPORTANT — intentionally STATIC (no tilt reactivity). An RNSkia `<Canvas>` is
 * an Android `TextureView` whose content updates below the 120Hz display rate;
 * redrawing the shadow every frame during tilt would lag/stutter behind the
 * card. A fixed shadow renders once and composites smoothly.
 */

import { Canvas, RoundedRect, Shadow } from '@shopify/react-native-skia';

// Extra room around the card so the blurred shadow is not clipped by the canvas.
const PAD = 40;

interface ShadowLayerProps {
    width: number;
    height: number;
    radius?: number;
}

export const ShadowLayer = ({ width, height, radius = 24 }: ShadowLayerProps) => {
    return (
        <Canvas
            style={{
                position: 'absolute',
                left: -PAD,
                top: -PAD,
                width: width + PAD * 2,
                height: height + PAD * 2,
            }}
            pointerEvents="none">
            <RoundedRect x={PAD} y={PAD} width={width} height={height} r={radius} color="black">
                <Shadow dx={0} dy={13} blur={20} color="rgba(0,0,0,0.34)" shadowOnly />
            </RoundedRect>
        </Canvas>
    );
};
