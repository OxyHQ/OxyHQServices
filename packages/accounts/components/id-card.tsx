import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import Svg, { Defs, RadialGradient, Stop, Path, Filter, FeGaussianBlur } from 'react-native-svg';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from 'react-native-reanimated';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { UserAvatar } from '@/components/user-avatar';

export interface IdCardProps {
  id: string;
  name: string;
  imageUrl?: string;
  title: string;
  value: string;
  onPress?: () => void;
  onPressIn?: () => void;
}

// Conic gradient component with rotation animation
const ConicGradientBackground = ({ cardWidth, cardHeight }: { cardWidth: number; cardHeight: number }) => {
  const gradientSize = 900;
  const centerX = gradientSize / 2;
  const centerY = gradientSize / 2;
  const radius = gradientSize / 2;

  // Rotation animation
  const rotation = useSharedValue(0);

  React.useEffect(() => {
    rotation.value = withRepeat(
      withTiming(360, { duration: 8000, easing: Easing.linear }),
      -1,
      false
    );
  }, [rotation]);

  // Convert degrees to radians
  const degToRad = (deg: number) => (deg * Math.PI) / 180;

  // Calculate points for each color stop
  const getPoint = (angle: number, r: number) => ({
    x: centerX + r * Math.cos(degToRad(angle - 90)), // -90 to start from top
    y: centerY + r * Math.sin(degToRad(angle - 90)),
  });

  // Color stops from the conic gradient
  const colorStops = [
    { angle: 0, color: 'rgba(52,168,82,0)' },
    { angle: 38.9738, color: 'rgba(52,168,82,1)' },
    { angle: 62.3678, color: 'rgba(255,211,20,1)' },
    { angle: 87.0062, color: 'rgba(255,70,65,1)' },
    { angle: 107.428, color: 'rgba(49,134,255,1)' },
    { angle: 204.48, color: 'rgba(49,134,255,0.5)' },
    { angle: 308.88, color: 'rgba(49,134,255,0)' },
    { angle: 360, color: 'rgba(52,168,82,0)' },
  ];

  const animatedStyle = useAnimatedStyle(() => {
    const left = cardWidth / 2 - gradientSize / 2;
    const top = cardHeight / 2 - gradientSize / 2;

    return {
      position: 'absolute',
      left,
      top,
      width: gradientSize,
      height: gradientSize,
      transform: [
        { rotate: `${rotation.value}deg` },
        { scaleX: 1 },
        { scaleY: 0.4 },
      ],
    };
  });

  return (
    <Animated.View style={animatedStyle} pointerEvents="none">
      <Svg width={gradientSize} height={gradientSize}>
        <Defs>
          <Filter id="blur">
            <FeGaussianBlur in="SourceGraphic" stdDeviation="20" />
          </Filter>
          {colorStops.slice(0, -1).map((stop, i) => {
            const nextStop = colorStops[i + 1];
            // Create radial gradient for each segment to blend colors
            return (
              <RadialGradient
                key={`grad-${i}`}
                id={`grad-${i}`}
                cx="50%"
                cy="50%"
                r="50%"
              >
                <Stop offset="0%" stopColor={stop.color} />
                <Stop offset="100%" stopColor={nextStop.color} />
              </RadialGradient>
            );
          })}
        </Defs>
        {/* Create pie slices for each segment */}
        {colorStops.slice(0, -1).map((stop, i) => {
          const nextStop = colorStops[i + 1];
          const start = getPoint(stop.angle, radius);
          const end = getPoint(nextStop.angle, radius);
          const largeArcFlag = nextStop.angle - stop.angle > 180 ? 1 : 0;

          const path = `M ${centerX} ${centerY} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} Z`;

          return (
            <Path
              key={`segment-${i}`}
              d={path}
              fill={`url(#grad-${i})`}
              filter="url(#blur)"
            />
          );
        })}
      </Svg>
    </Animated.View>
  );
};

export function IdCard({ name, imageUrl, title, value, onPress, onPressIn }: IdCardProps) {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
  const [cardDimensions, setCardDimensions] = React.useState({ width: 300, height: 200 });

  const handleLayout = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setCardDimensions({ width, height });
    }
  };

  return (
    <TouchableOpacity
      style={styles.idCard}
      onPressIn={onPressIn}
      onPress={onPress}
      activeOpacity={1}
      disabled={!onPress}
      onLayout={handleLayout}
    >
      {/* Conic gradient background */}
      <ConicGradientBackground cardWidth={cardDimensions.width} cardHeight={cardDimensions.height} />

      {/* White blur overlay - blurs the gradient behind it */}
      <BlurView
        intensity={80}
        tint="light"
        style={[StyleSheet.absoluteFill, styles.blurOverlay]}
        pointerEvents="none"
        experimentalBlurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
      />

      {/* Content container - positioned relative, on top, not blurred */}
      <View style={styles.contentContainer}>
        <View style={styles.avatarContainer}>
          <UserAvatar name={name} imageUrl={imageUrl} size={36} />
        </View>
        <View style={styles.spacer} />
        <View style={styles.textContainer}>
          <Text style={[styles.idCardTitle, { color: colors.secondaryText }]}>{title}</Text>
          <Text style={[styles.idCardValue, { color: colors.text }]}>{value}</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  idCard: {
    minWidth: '48%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'transparent',
    alignSelf: 'flex-start',
    overflow: 'hidden',
  } as const,
  blurOverlay: {
    borderRadius: 14,
    backgroundColor: '#ffffffc2', // White with transparency
    margin: 2,
  } as const,
  contentContainer: {
    position: 'relative',
    padding: 16,
    zIndex: 1,
  } as const,
  avatarContainer: {
    alignItems: 'flex-start',
  } as const,
  spacer: {
    height: 20,
  } as const,
  textContainer: {
    gap: 4,
  } as const,
  idCardTitle: {
    fontSize: 12,
    fontWeight: '500',
  } as const,
  idCardValue: {
    fontSize: 20,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'web' ? 'Phudu' : 'Phudu-Bold',
  } as const,
});

