import React from 'react';
import Svg, { Path } from 'react-native-svg';
import type { ViewStyle } from 'react-native';

/**
 * The Commons wordmark glyph — three interlocking lenses. Source of truth is
 * `assets/images/commons-logo.svg`; the path is inlined here (there is no
 * react-native-svg-transformer in this app) so it renders as a crisp vector at
 * any size/colour, exactly like `LogoIcon` does for the Oxy mark.
 */
const COMMONS_PATH =
    'M640-162q-18.09 0-34.9-1.57-16.8-1.57-34.1-5.43 72-63 113.5-143.5Q726-393.01 726-480q0-88-41.5-168T571-791q16.89-3.62 34.1-5.31Q622.3-798 640-798q132.45 0 225.22 92.89Q958-612.22 958-479.61T865.22-254.5Q772.45-162 640-162Zm-160-43q-71-42-114.5-114.5T322-480q0-88 43.5-160.5T480-755q71 42 114.5 114.5T638-480q0 88-43.5 160.5T480-205Zm-160 43q-132.45 0-225.22-92.89Q2-347.78 2-480.39T94.78-705.5Q187.55-798 320-798q18.09 0 34.9 1.57 16.8 1.57 34.1 5.43-72 63-113.5 143.16Q234-567.67 234-480.29 234-385 274.5-304 315-223 382-167q-14.47 2.63-30.22 3.82Q336.03-162 320-162Z';

interface CommonsLogoProps {
    /** Square edge length in pixels. */
    size?: number;
    /** Glyph fill colour. */
    color?: string;
    style?: ViewStyle;
}

export function CommonsLogo({ size = 24, color = '#ffffff', style }: CommonsLogoProps) {
    return (
        <Svg width={size} height={size} viewBox="0 -960 960 960" style={style}>
            <Path d={COMMONS_PATH} fill={color} />
        </Svg>
    );
}
