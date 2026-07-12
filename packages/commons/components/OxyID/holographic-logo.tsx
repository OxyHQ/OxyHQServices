/**
 * The Oxy issuer mark rendered as engraved, tilt-iridescent lines — the header
 * counterpart to the Commons emblem in the card body. Instead of the solid brand
 * fill, the mark is STROKED and lit with the SAME tilt-driven iridescence as the
 * card's guilloché hologram, so it reads as part of the security engraving and
 * shimmers as the phone turns.
 *
 * Rendered as face content (not in the shared hologram layer) so the back face's
 * counter-mirror keeps it upright. Must be mounted inside the card `TiltProvider`.
 */

import { type FC, useMemo } from 'react';

import { Canvas, Group, LinearGradient, Path, Skia, vec } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import { useTilt } from './tilt-context';
import { OXY_INNER_OFFSET, OXY_INNER_PATH, OXY_LETTERS_PATH, OXY_OUTER_PATH, OXY_VIEWBOX } from './logo-paths';

// Full-spectrum iridescence, matching the guilloché hologram on the card body.
const IRIDESCENT = ['#ff4d6d', '#ff9e2c', '#ffe14d', '#43e97b', '#22d3ee', '#4f8dff', '#a06bff', '#ff6bd6'];

// A hair of padding so the outermost stroke isn't clipped by the canvas edge.
const PAD = 2;

const ASPECT = OXY_VIEWBOX.width / OXY_VIEWBOX.height;

/**
 * Composite the outer silhouette with the two inner detail paths (which live
 * under a translate(465,188) group in the source), then scale the whole mark to
 * fit a `size`-tall box pinned at (PAD, PAD).
 */
const buildOxyMark = (size: number) => {
    const outer = Skia.Path.MakeFromSVGString(OXY_OUTER_PATH);
    const inner = Skia.Path.MakeFromSVGString(OXY_INNER_PATH);
    const letters = Skia.Path.MakeFromSVGString(OXY_LETTERS_PATH);
    if (!outer || !inner || !letters) return null;

    // Inner paths are drawn under translate(465,188) in LogoIcon.
    const offset = Skia.Matrix([1, 0, OXY_INNER_OFFSET.x, 0, 1, OXY_INNER_OFFSET.y, 0, 0, 1]);
    inner.transform(offset);
    letters.transform(offset);
    outer.addPath(inner);
    outer.addPath(letters);

    // viewBox → padded size-box (uniform scale, top-left origin).
    const s = size / OXY_VIEWBOX.height;
    const tx = PAD - OXY_VIEWBOX.minX * s;
    const ty = PAD - OXY_VIEWBOX.minY * s;
    outer.transform(Skia.Matrix([s, 0, tx, 0, s, ty, 0, 0, 1]));
    return outer;
};

interface HolographicLogoProps {
    /** Height of the mark in px (width follows the logo aspect ratio). */
    size?: number;
}

export const HolographicLogo: FC<HolographicLogoProps> = ({ size = 22 }) => {
    const { nx, ny, mag } = useTilt();

    const mark = useMemo(() => buildOxyMark(size), [size]);

    const w = size * ASPECT + PAD * 2;
    const h = size + PAD * 2;

    // Diagonal iridescence band whose endpoints slide with tilt — the SAME motion
    // as the card's guilloché, so the mark shimmers in step with the hologram.
    const start = useDerivedValue(() => vec(w * (-0.3 + nx.value * 0.6), h * (-0.3 + ny.value * 0.6)));
    const end = useDerivedValue(() => vec(w * (1.3 + nx.value * 0.6), h * (1.3 + ny.value * 0.6)));
    // Reads clearly at rest (small mark) and flares as you tilt.
    const opacity = useDerivedValue(() => Math.min(1, 0.55 + mag.value * 0.45));

    if (!mark) return null;

    return (
        <Canvas style={{ width: w, height: h }} pointerEvents="none">
            {/* Faint engraved base so the mark stays legible where the band is dim. */}
            <Path path={mark} style="stroke" strokeWidth={0.8} color="rgba(120,120,140,0.32)" />
            {/* Tilt-driven iridescence on the same lines. */}
            <Group opacity={opacity}>
                <Path path={mark} style="stroke" strokeWidth={1}>
                    <LinearGradient start={start} end={end} colors={IRIDESCENT} />
                </Path>
            </Group>
        </Canvas>
    );
};
