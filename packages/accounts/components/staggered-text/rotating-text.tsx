import React, { useEffect, useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, type ViewStyle, type TextStyle, LayoutChangeEvent } from 'react-native';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withTiming,
    Easing,
    runOnJS,
} from 'react-native-reanimated';
import { StaggeredText } from './index';

type TextItem = string | string[];

interface RotatingTextAnimationProps {
    texts: TextItem[];
    fontSize?: number;
    lineHeight?: number;
    interval?: number;
    duration?: number;
    textStyle?: TextStyle;
    containerStyle?: ViewStyle;
}

export function RotatingTextAnimation({
    texts,
    fontSize = 64,
    lineHeight,
    interval = 3000,
    duration = 600,
    textStyle,
    containerStyle,
}: RotatingTextAnimationProps) {
    // Calculate lineHeight based on fontSize if not provided (1.4x multiplier for better spacing)
    const calculatedLineHeight = lineHeight ?? fontSize * 1.4;
    const translateY = useSharedValue(0);
    const containerHeight = useSharedValue(calculatedLineHeight);
    const indexRef = React.useRef(0);

    // Store measured heights for each text item
    const [measuredHeights, setMeasuredHeights] = useState<Map<number, number>>(new Map());

    // Normalize texts: convert strings to arrays for consistent handling
    const normalizedTexts = useMemo(() => {
        return texts.map(text => Array.isArray(text) ? text : [text]);
    }, [texts]);

    // Calculate heights for each text item
    // Use measured heights if available, otherwise estimate based on text length
    const textHeights = useMemo(() => {
        return normalizedTexts.map((lines, index) => {
            // If we have a measured height, use it (phrases may wrap naturally)
            const measured = measuredHeights.get(index);
            if (measured) {
                return measured;
            }

            // If it's explicitly split into multiple lines, use that
            if (lines.length > 1) {
                return lines.length * calculatedLineHeight;
            }

            // Estimate height for single-line strings that might wrap
            // Longer phrases are more likely to wrap, so estimate more height
            const text = lines[0];
            const estimatedLines = Math.max(1, Math.ceil(text.length / 15)); // Rough estimate: ~15 chars per line
            return estimatedLines * calculatedLineHeight;
        });
    }, [normalizedTexts, calculatedLineHeight, measuredHeights]);

    // Calculate cumulative positions for each text item
    const textPositions = useMemo(() => {
        const positions: number[] = [];
        let currentPosition = 0;
        textHeights.forEach(height => {
            positions.push(currentPosition);
            currentPosition += height;
        });
        return positions;
    }, [textHeights]);

    // Total height of all texts combined
    const totalHeight = useMemo(() => {
        return textHeights.reduce((sum, height) => sum + height, 0);
    }, [textHeights]);

    // Memoize the full list to render - we render 3 copies of the array to enable seamless looping
    const textList = useMemo(() => {
        // Render 3 copies of the array for seamless infinite loop
        return [...normalizedTexts, ...normalizedTexts, ...normalizedTexts];
    }, [normalizedTexts]);

    // Calculate positions for the tripled list using actual textHeights
    const textListPositions = useMemo(() => {
        const positions: number[] = [];
        let currentPosition = 0;
        textList.forEach((lines, index) => {
            positions.push(currentPosition);
            const originalIndex = index % normalizedTexts.length;
            const height = textHeights[originalIndex] || lines.length * calculatedLineHeight;
            currentPosition += height;
        });
        return positions;
    }, [textList, textHeights, normalizedTexts.length, calculatedLineHeight]);

    const rotatingStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }));

    const containerAnimatedStyle = useAnimatedStyle(() => ({
        height: containerHeight.value,
    }));

    const onRotationComplete = useCallback(() => {
        indexRef.current = (indexRef.current + 1) % texts.length;
        // Reset to middle section immediately without animation to avoid pause
        const resetPosition = totalHeight + textPositions[indexRef.current];
        translateY.value = -resetPosition;

        // Update container height to match the new current item
        const newHeight = textHeights[indexRef.current] || calculatedLineHeight;
        containerHeight.value = withTiming(newHeight, {
            duration: duration * 0.5,
            easing: Easing.out(Easing.cubic),
        });
    }, [texts.length, totalHeight, textPositions, textHeights, calculatedLineHeight, duration, translateY, containerHeight]);

    // Calculate the maximum height needed for any single text item
    // Use exact height to ensure only one item is visible at a time
    const maxTextHeight = useMemo(() => {
        if (textHeights.length === 0) {
            return calculatedLineHeight;
        }
        const max = Math.max(...textHeights, calculatedLineHeight);
        // Use exact height, no padding, to prevent multiple items showing
        return max;
    }, [textHeights, calculatedLineHeight]);

    useEffect(() => {
        let isActive = true;
        let intervalId: ReturnType<typeof setInterval>;

        const startRotation = () => {
            intervalId = setInterval(() => {
                if (!isActive) return;

                // Calculate the height of the current text item
                const currentTextHeight = textHeights[indexRef.current];

                // Get the next item's height for container resize
                const nextIndex = (indexRef.current + 1) % texts.length;
                const nextTextHeight = textHeights[nextIndex] || calculatedLineHeight;

                // Update container height to match next item (animate smoothly)
                containerHeight.value = withTiming(nextTextHeight, {
                    duration: duration * 0.8,
                    easing: Easing.out(Easing.cubic),
                });

                // Animate upward - slide current text up, next text appears from below
                // Use linear easing for smoother continuous motion
                translateY.value = withTiming(
                    translateY.value - currentTextHeight,
                    {
                        duration,
                        easing: Easing.linear,
                    },
                    (finished) => {
                        if (finished && isActive) {
                            runOnJS(onRotationComplete)();
                        }
                    }
                );
            }, interval);
        };

        const startDelay = setTimeout(startRotation, interval);

        return () => {
            isActive = false;
            clearTimeout(startDelay);
            clearInterval(intervalId);
        };
    }, [texts, textHeights, totalHeight, interval, duration, calculatedLineHeight, translateY, containerHeight, onRotationComplete]);

    // Initialize translateY and container height immediately when values are available
    useEffect(() => {
        if (totalHeight > 0 && textHeights.length > 0) {
            // Position first text of middle section at the top of container
            translateY.value = -totalHeight;
            indexRef.current = 0;
            // Set initial container height to match first item
            const initialHeight = textHeights[0] || calculatedLineHeight;
            containerHeight.value = initialHeight;
        }
    }, [totalHeight, textHeights, calculatedLineHeight, translateY, containerHeight]);

    // Update container height whenever the current item's measured height changes
    useEffect(() => {
        if (textHeights.length > 0 && indexRef.current < textHeights.length) {
            const currentHeight = textHeights[indexRef.current] || calculatedLineHeight;
            // Smoothly update container height to match current phrase
            if (Math.abs(containerHeight.value - currentHeight) > 1) {
                containerHeight.value = withTiming(currentHeight, {
                    duration: 300,
                    easing: Easing.out(Easing.cubic),
                });
            }
        }
    }, [textHeights, calculatedLineHeight, containerHeight]);

    // Handle layout measurement for actual text heights
    const handleTextLayout = useCallback((index: number, height: number) => {
        setMeasuredHeights(prev => {
            const newMap = new Map(prev);
            // Map back to original index (accounting for tripled list)
            const originalIndex = index % normalizedTexts.length;
            // Only update if the measured height is significantly different
            const current = prev.get(originalIndex);
            if (!current || Math.abs(current - height) > 2) {
                newMap.set(originalIndex, height);

                // If this is the currently visible item, update container height immediately
                if (originalIndex === indexRef.current) {
                    containerHeight.value = withTiming(height, {
                        duration: 200,
                        easing: Easing.out(Easing.cubic),
                    });
                }

                return newMap;
            }
            return prev;
        });
    }, [normalizedTexts.length, containerHeight]);

    return (
        <Animated.View style={[styles.container, containerAnimatedStyle, containerStyle]}>
            <Animated.View style={[rotatingStyle, { overflow: 'visible' }]}>
                {textList.map((lines, index) => {
                    // Calculate absolute position for this text item
                    const absolutePosition = textListPositions[index];
                    // Use estimated height, will be updated by measurement
                    const originalIndex = index % normalizedTexts.length;
                    const itemHeight = textHeights[originalIndex] || lines.length * calculatedLineHeight;

                    return (
                        <AnimatedTextItem
                            key={index}
                            lines={lines}
                            fontSize={fontSize}
                            lineHeight={calculatedLineHeight}
                            itemHeight={itemHeight}
                            maxTextHeight={maxTextHeight}
                            textStyle={textStyle}
                            absolutePosition={absolutePosition}
                            translateY={translateY}
                            onLayout={(height) => handleTextLayout(index, height)}
                        />
                    );
                })}
            </Animated.View>
        </Animated.View>
    );
}

// Separate component to handle text item opacity based on position
interface AnimatedTextItemProps {
    lines: string[];
    fontSize: number;
    lineHeight: number;
    itemHeight: number;
    maxTextHeight: number;
    textStyle?: TextStyle;
    absolutePosition: number;
    translateY: ReturnType<typeof useSharedValue<number>>;
    onLayout?: (height: number) => void;
}

function AnimatedTextItem({
    lines,
    fontSize,
    lineHeight,
    itemHeight,
    maxTextHeight,
    textStyle,
    absolutePosition,
    translateY,
    onLayout,
}: AnimatedTextItemProps) {
    const handleLayout = useCallback((event: LayoutChangeEvent) => {
        const { height } = event.nativeEvent.layout;
        if (onLayout && height > 0) {
            onLayout(height);
        }
    }, [onLayout]);
    const animatedStyle = useAnimatedStyle(() => {
        'worklet';
        // Calculate the current screen position of this item (relative to container top)
        const screenPosition = absolutePosition + translateY.value;

        // 3D slot machine effect: rotate around X-axis based on position
        // Rotate from 0° at top to -90° as it moves up and out
        const rotationX = (screenPosition / itemHeight) * -90;

        // Opacity: ensure smooth transitions between consecutive items
        // Handle different heights by using adaptive fade range
        // For items moving up: fade out over their own height
        // For items moving up from below: fade in based on distance to top
        let opacity = 0;

        if (screenPosition <= 0) {
            // At top or moving up and out - fade out quickly as it rotates up
            // Use smaller fade range for faster fade
            const fadeRange = itemHeight * 0.4; // Faster fade - 40% of item height
            if (screenPosition >= -fadeRange) {
                // screenPosition = 0: opacity = 1 (at top)
                // screenPosition = -fadeRange: opacity = 0 (moved up and out, completely faded)
                opacity = Math.max(0, 1 + (screenPosition / fadeRange));
            } else {
                // Beyond fade range - completely invisible
                opacity = 0;
            }
        } else {
            // Below top - fade in quickly as it approaches top during rotation
            // Use smaller fade range for faster fade
            const fadeRange = itemHeight * 0.4; // Faster fade - 40% of item height
            if (screenPosition <= fadeRange) {
                // screenPosition = fadeRange: opacity = 0 (just starting)
                // screenPosition approaches 0: opacity = 1 (reaching top)
                opacity = 1 - (screenPosition / fadeRange);
            } else {
                // Too far below - completely invisible
                opacity = 0;
            }
        }

        return {
            opacity,
            transform: [
                { rotateX: `${rotationX}deg` as any },
            ],
        };
    });

    return (
        <Animated.View
            style={[styles.textItem, { minHeight: itemHeight }, animatedStyle]}
            onLayout={handleLayout}
        >
            {lines.map((line, lineIndex) => (
                <View
                    key={lineIndex}
                    style={styles.textLine}
                >
                    <StaggeredText text={line} fontSize={fontSize} textStyle={textStyle} />
                </View>
            ))}
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    container: {
        overflow: 'hidden',
        width: '100%',
    },
    textItem: {
        width: '100%',
        minWidth: '100%',
        overflow: 'visible',
        backfaceVisibility: 'hidden',
        margin: 0,
        padding: 0,
    },
    textLine: {
        justifyContent: 'flex-start',
        alignItems: 'flex-start',
        width: '100%',
        minWidth: '100%',
        overflow: 'visible',
        margin: 0,
        padding: 0,
        flexShrink: 0,
        flexWrap: 'wrap',
    },
});
