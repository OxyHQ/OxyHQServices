/**
 * Base holographic layer of the Oxy ID card — a WHITE card with a fine engraved
 * GUILLOCHÉ pattern (smooth rosette curves, like the engine-turned lines on
 * official ID / banknote holograms). The card itself is white; the rainbow is
 * ONLY the holographic effect that lives on the guilloché lines and SHIFTS as
 * the phone tilts.
 *
 * The iridescence uses a LINEAR gradient (a directional band, NO centre pivot) so
 * there is no visible "colour-wheel" hotspot. Uses only plain GPU gradients +
 * stroked Paths — no `Mask`/`BlurMask` (blocky on Android).
 */

import { type FC, useMemo } from 'react';

import {
    Canvas,
    Group,
    LinearGradient,
    Path,
    RoundedRect,
    Skia,
    vec,
} from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';

import { useTilt } from './OxyID/tilt-context';

interface HolographicCardProps {
    width: number;
    height: number;
}

// Full-spectrum iridescence for the line shimmer.
const IRIDESCENT = [
    '#ff4d6d',
    '#ff9e2c',
    '#ffe14d',
    '#43e97b',
    '#22d3ee',
    '#4f8dff',
    '#a06bff',
    '#ff6bd6',
];

// Guilloché rosette: a set of nested flower curves (radius modulated by a
// sinusoid) with alternating phase, so the rings interleave into the classic
// engine-turned weave. Smooth curves — no straight-chord mesh.
const buildGuilloche = (width: number, height: number) => {
    const path = Skia.Path.Make();
    const cx = width / 2;
    const cy = height / 2;
    const aspect = width / height;
    const maxR = Math.min(width, height) * 0.52;
    const rings = 7;
    const petals = 14;
    const steps = 260;
    for (let m = 1; m <= rings; m++) {
        const baseR = (m / rings) * maxR;
        const amp = baseR * 0.16;
        const phase = m % 2 === 0 ? Math.PI / petals : 0;
        for (let i = 0; i <= steps; i++) {
            const t = (i / steps) * Math.PI * 2;
            const r = baseR + amp * Math.cos(petals * t + phase);
            const x = cx + r * Math.cos(t) * aspect;
            const y = cy + r * Math.sin(t);
            if (i === 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        }
    }
    return path;
};

export const HolographicCard: FC<HolographicCardProps> = ({ width, height }) => {
    const { nx, ny, mag, isPressed, scanPulse, attestGlow } = useTilt();

    const guilloche = useMemo(() => buildGuilloche(width, height), [width, height]);

    // Diagonal iridescence band (NO centre pivot). Its endpoints shift with tilt,
    // so the rainbow slides along the guilloché lines as the phone turns.
    const irisStart = useDerivedValue(() =>
        vec(width * (-0.3 + nx.value * 0.6), height * (-0.3 + ny.value * 0.6)),
    );
    const irisEnd = useDerivedValue(() =>
        vec(width * (1.3 + nx.value * 0.6), height * (1.3 + ny.value * 0.6)),
    );

    // Subtle at rest → flares as you tilt (the reflejo); attestGlow boosts it
    // further on server-confirmed attestation (level-2 feedback).
    const irisOpacity = useDerivedValue(() =>
        Math.min(1, 0.32 + mag.value * 0.45 + isPressed.value * 0.16 + attestGlow.value * 0.5),
    );

    // Glossy laminate sheen — a bright diagonal glare streak that sweeps across
    // the surface (opposite the tilt), like light on a plastic card. A cool tint
    // so it reads as a glass reflection on the white stock.
    const glossStart = useDerivedValue(() =>
        vec(
            width * (0.5 - nx.value * 0.7) - width * 0.5,
            height * (0.5 - ny.value * 0.7) - height * 0.5,
        ),
    );
    const glossEnd = useDerivedValue(() =>
        vec(
            width * (0.5 - nx.value * 0.7) + width * 0.5,
            height * (0.5 - ny.value * 0.7) + height * 0.5,
        ),
    );
    const glossOpacity = useDerivedValue(() =>
        Math.min(0.7, 0.28 + mag.value * 0.4 + isPressed.value * 0.22),
    );

    // NFC-read shine: a narrow diagonal band that sweeps corner-to-corner as
    // scanPulse runs 0→1, fading in/out with sin(π·t) so it never pops.
    const scanBandStart = useDerivedValue(() => {
        const p = scanPulse.value * 2 - 1;
        return vec(width * (p - 0.6), height * (p - 0.6));
    });
    const scanBandEnd = useDerivedValue(() => {
        const p = scanPulse.value * 2 - 1;
        return vec(width * (p + 0.6), height * (p + 0.6));
    });
    const scanBandOpacity = useDerivedValue(() =>
        Math.sin(Math.min(1, Math.max(0, scanPulse.value)) * Math.PI) * 0.9,
    );

    // Attestation-confirmed edge glow.
    const attestEdgeOpacity = useDerivedValue(() => attestGlow.value * 0.9);

    return (
        <Canvas style={{ width, height, backgroundColor: 'transparent' }}>
            <Group>
                {/* White card stock. */}
                <RoundedRect x={0} y={0} width={width} height={height} r={24} color="#FFFFFF" />

                {/* Faint engraved guilloché — always visible on white so the
                    pattern reads even where the rainbow is dim. */}
                <Path
                    path={guilloche}
                    style="stroke"
                    strokeWidth={0.5}
                    color="rgba(120,120,140,0.13)"
                />

                {/* Holographic iridescence on the SAME lines — a diagonal rainbow
                    band (no pivot) that slides with tilt. */}
                <Group opacity={irisOpacity}>
                    <Path path={guilloche} style="stroke" strokeWidth={0.9}>
                        <LinearGradient start={irisStart} end={irisEnd} colors={IRIDESCENT} />
                    </Path>
                </Group>

                {/* Glossy laminate sheen — the bright diagonal glare that sweeps
                    across the surface, giving the physical-card feel. */}
                <Group opacity={glossOpacity}>
                    <RoundedRect x={0} y={0} width={width} height={height} r={24}>
                        <LinearGradient
                            start={glossStart}
                            end={glossEnd}
                            colors={[
                                'rgba(235,244,255,0)',
                                'rgba(235,244,255,0)',
                                'rgba(240,248,255,0.85)',
                                'rgba(255,255,255,0.95)',
                                'rgba(240,248,255,0.85)',
                                'rgba(235,244,255,0)',
                                'rgba(235,244,255,0)',
                            ]}
                            positions={[0, 0.4, 0.47, 0.5, 0.53, 0.6, 1]}
                        />
                    </RoundedRect>
                </Group>

                {/* NFC-read shine sweep (scanPulse-driven; invisible at rest). */}
                <Group opacity={scanBandOpacity}>
                    <RoundedRect x={0} y={0} width={width} height={height} r={24}>
                        <LinearGradient
                            start={scanBandStart}
                            end={scanBandEnd}
                            colors={[
                                'rgba(255,255,255,0)',
                                'rgba(255,255,255,0)',
                                'rgba(255,255,255,0.9)',
                                'rgba(255,255,255,0)',
                                'rgba(255,255,255,0)',
                            ]}
                            positions={[0, 0.42, 0.5, 0.58, 1]}
                        />
                    </RoundedRect>
                </Group>

                {/* Attestation-confirmed iridescent edge glow (attestGlow-driven). */}
                <Group opacity={attestEdgeOpacity}>
                    <RoundedRect
                        x={1.5}
                        y={1.5}
                        width={width - 3}
                        height={height - 3}
                        r={23}
                        style="stroke"
                        strokeWidth={3}>
                        <LinearGradient start={vec(0, 0)} end={vec(width, height)} colors={IRIDESCENT} />
                    </RoundedRect>
                </Group>

                {/* Subtle edge definition. */}
                <RoundedRect
                    x={1}
                    y={1}
                    width={width - 2}
                    height={height - 2}
                    r={23}
                    style="stroke"
                    strokeWidth={1}
                    color="rgba(150,150,170,0.25)"
                />
            </Group>
        </Canvas>
    );
};
