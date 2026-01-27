import React, { ReactElement } from 'react';
import Svg, { G, Path } from 'react-native-svg';
import { ViewStyle } from 'react-native';
import { useTheme } from '@/hooks/useTheme';

interface LogoIconProps {
  color?: string;
  height?: number;
  size?: number; // Deprecated: use height instead
  style?: ViewStyle;
}

export const LogoIcon: React.FC<LogoIconProps> = ({
  color,
  height: heightProp,
  size, // For backwards compatibility
  style,
}): ReactElement => {
  // Use height prop, or fall back to size (for backwards compatibility)
  const height = heightProp || size || 26;
  // Calculate width based on aspect ratio from SVG viewBox
  // viewBox: "0 0 498 145" -> aspect ratio ≈ 3.43 (wider than tall)
  const width = height * (498 / 145);

  // Get theme colors
  const theme = useTheme();
  const isDark = theme?.mode === 'dark';

  // Use provided color, or default based on theme
  const fillColor = color !== undefined
    ? color
    : (isDark ? '#ffffff' : '#000000');

  return (
    <Svg viewBox="0 0 498 145" width={width} height={height} style={style}>
      <G transform="translate(0, 145) scale(0.1, -0.1)">
        {/* O letter */}
        <Path
          d="M1165 1320 c-101 -16 -285 -79 -390 -134 -160 -83 -243 -143 -361 -261 -123 -122 -176 -196 -224 -312 -42 -99 -47 -210 -14 -284 64 -139 206 -209 425 -209 161 0 322 42 493 127 106 53 165 59 235 24 l42 -22 70 47 c38 26 69 49 69 51 0 1 -9 17 -20 35 -27 44 -25 78 5 122 14 20 25 40 25 44 0 4 -27 31 -59 60 l-59 52 -36 -15 c-49 -21 -123 -18 -175 6 l-45 20 -68 -46 -68 -45 20 -32 c25 -42 25 -84 0 -126 -27 -43 -67 -66 -180 -102 -139 -43 -194 -53 -279 -48 -99 6 -161 33 -196 87 -24 36 -27 48 -23 109 12 213 296 502 621 632 280 112 501 82 574 -77 17 -36 28 -82 32 -132 l6 -76 64 0 65 0 13 50 c63 243 -121 448 -412 460 -49 2 -117 0 -150 -5z m121 -810 c53 0 54 -1 43 -21 -6 -12 -9 -36 -7 -55 4 -32 3 -33 -22 -26 -14 3 -46 6 -72 5 -43 -1 -47 1 -38 17 6 10 10 35 10 55 0 30 3 36 16 31 9 -3 40 -6 70 -6z"
          fill={fillColor}
        />
        {/* X letter */}
        <Path
          d="M2092 1016 l298 -293 -233 -230 c-127 -126 -260 -256 -294 -288 -35 -32 -63 -62 -63 -67 0 -4 58 -8 129 -8 l129 0 242 238 c133 130 245 238 249 239 3 1 116 -106 251 -237 l245 -239 135 0 135 -1 -301 295 -301 294 296 296 296 295 -134 0 -134 0 -238 -235 c-130 -129 -241 -235 -246 -235 -4 1 -116 106 -248 235 l-240 235 -135 0 -135 -1 297 -293z"
          fill={fillColor}
        />
        {/* Y letter */}
        <Path
          d="M3476 1218 c44 -51 171 -201 284 -333 113 -132 224 -263 248 -291 l42 -52 0 -206 0 -206 100 0 100 0 0 211 0 210 138 162 c75 89 219 257 320 374 100 117 182 215 182 218 0 3 -55 5 -123 5 l-122 0 -160 -192 c-88 -105 -198 -238 -245 -294 -47 -57 -89 -102 -93 -101 -5 1 -117 133 -251 292 l-242 290 -128 3 -128 3 78 -93z"
          fill={fillColor}
        />
      </G>
    </Svg>
  );
};
