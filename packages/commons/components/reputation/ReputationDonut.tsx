import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';

/** One proportional ring segment. */
export interface DonutSegment {
  key: string;
  /** Non-negative magnitude; the segment's sweep is its share of the total. */
  value: number;
  /** Stroke colour for the segment. */
  color: string;
}

interface ReputationDonutProps {
  /** Outer diameter, in dp. */
  size: number;
  /** Ring thickness, in dp. */
  strokeWidth: number;
  segments: DonutSegment[];
  /** The empty-track colour shown behind segments / when nothing is earned. */
  trackColor: string;
  /** Centred overlay (e.g. the total label). */
  children?: React.ReactNode;
}

/** Degrees of empty space inserted between adjacent segments. */
const SEGMENT_GAP_DEGREES = 4;
const START_ANGLE = -90;

/**
 * A proportional donut ring drawn with Skia. Each segment's arc length is its
 * share of the summed segment values; segments with a zero value are skipped. A
 * full faint track is always drawn underneath (and is the sole ring when there
 * is nothing to show). `children` are centred over the hole.
 */
export function ReputationDonut({
  size,
  strokeWidth,
  segments,
  trackColor,
  children,
}: ReputationDonutProps) {
  const inset = strokeWidth / 2;
  const dimension = size - strokeWidth;

  const trackPath = useMemo(() => {
    const path = Skia.Path.Make();
    path.addArc(Skia.XYWHRect(inset, inset, dimension, dimension), 0, 360);
    return path;
  }, [inset, dimension]);

  const arcs = useMemo(() => {
    const positive = segments.filter((segment) => segment.value > 0);
    const total = positive.reduce((sum, segment) => sum + segment.value, 0);
    if (total <= 0) return [];

    const oval = Skia.XYWHRect(inset, inset, dimension, dimension);
    const multiple = positive.length > 1;
    let cursor = START_ANGLE;

    return positive.map((segment) => {
      const fullSweep = (segment.value / total) * 360;
      const drawnSweep = multiple ? Math.max(fullSweep - SEGMENT_GAP_DEGREES, 1) : fullSweep;
      const path = Skia.Path.Make();
      path.addArc(oval, cursor, drawnSweep);
      cursor += fullSweep;
      return { key: segment.key, color: segment.color, path };
    });
  }, [segments, inset, dimension]);

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }}>
        <Path
          path={trackPath}
          style="stroke"
          strokeWidth={strokeWidth}
          strokeCap="round"
          color={trackColor}
        />
        {arcs.map((arc) => (
          <Path
            key={arc.key}
            path={arc.path}
            style="stroke"
            strokeWidth={strokeWidth}
            strokeCap="round"
            color={arc.color}
          />
        ))}
      </Canvas>
      {children != null && <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
