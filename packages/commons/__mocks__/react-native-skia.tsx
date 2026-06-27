/**
 * Lightweight `@shopify/react-native-skia` stub for the jsdom test environment.
 *
 * The reputation donut draws with Skia, which has no jsdom backend. Component
 * tests only assert on the surrounding legend / labels (plain Views/Texts), so
 * the canvas itself renders nothing and the `Skia.Path` builder is a no-op
 * chainable. `Canvas` still renders its children so any non-Skia overlay nested
 * inside survives.
 */

import React from 'react';

interface CanvasProps {
  children?: React.ReactNode;
}

export const Canvas = ({ children }: CanvasProps): React.ReactElement =>
  React.createElement('div', { 'data-testid': 'skia-canvas' }, children);

export const Path = (): null => null;
export const Group = ({ children }: CanvasProps): React.ReactElement =>
  React.createElement(React.Fragment, null, children);
export const Circle = (): null => null;
export const Rect = (): null => null;
export const RoundedRect = (): null => null;
export const Mask = (): null => null;
export const BlurMask = (): null => null;
export const LinearGradient = (): null => null;

interface SkPathStub {
  addArc: () => SkPathStub;
  addCircle: () => SkPathStub;
}

function makePathStub(): SkPathStub {
  const stub: SkPathStub = {
    addArc: () => stub,
    addCircle: () => stub,
  };
  return stub;
}

export const Skia = {
  Path: { Make: (): SkPathStub => makePathStub() },
  XYWHRect: (): Record<string, never> => ({}),
};

export function interpolate(): number {
  return 0;
}
