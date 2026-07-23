import { createElement, type ReactNode } from 'react';

/**
 * Lightweight `react-native-svg` stub for the services jest environment (jsdom).
 *
 * The real package pulls RN's deprecated `Touchable.Mixin` at import time, which
 * the RN stub in this folder deliberately does not carry — so any component
 * rendering an SVG (the `LogoIcon` / `LogoText` wordmarks) would fail the whole
 * suite on import alone. These stubs render inert host elements: the logos are
 * pure presentation, so tests assert on their PRESENCE (`data-testid`), never on
 * path geometry.
 */

type SvgNodeProps = { children?: ReactNode; testID?: string } & Record<string, unknown>;

const svgNode =
  (testId: string) =>
  ({ children }: SvgNodeProps) =>
    createElement('span', { 'data-testid': testId }, children);

export const Svg = svgNode('svg');
export const G = svgNode('svg-g');
export const Path = svgNode('svg-path');
export const Circle = svgNode('svg-circle');
export const Rect = svgNode('svg-rect');
export const Defs = svgNode('svg-defs');
export const ClipPath = svgNode('svg-clip-path');
export const LinearGradient = svgNode('svg-linear-gradient');
export const Stop = svgNode('svg-stop');

export default Svg;
