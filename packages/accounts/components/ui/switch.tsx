import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, Animated, StyleSheet, View, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

interface SwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  style?: any;
}

export function Switch({ value, onValueChange, disabled, style }: SwitchProps) {
  const translateX = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: value ? 1 : 0,
      useNativeDriver: true,
      tension: 100,
      friction: 8,
    }).start();
  }, [value, translateX]);

  const handlePress = () => {
    if (!disabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onValueChange(!value);
    }
  };

  // iOS-style colors - flat design
  const trackColorOff = Platform.OS === 'ios' ? '#3A3A3C' : '#E5E5EA';
  const trackColorOn = '#34C759'; // Apple green
  const thumbColor = '#FFFFFF';

  // Smaller switch dimensions: 42px wide, 24px tall, thumb is 20px
  const thumbTranslateX = translateX.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 20], // 2px padding from left, 20px when on (track width 42 - thumb width 20 - padding 2)
  });

  const trackBackgroundColor = translateX.interpolate({
    inputRange: [0, 1],
    outputRange: [trackColorOff, trackColorOn],
  });

  return (
    <TouchableOpacity
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={0.7}
      style={[styles.container, style]}
    >
      <Animated.View
        style={[
          styles.track,
          {
            backgroundColor: trackBackgroundColor,
            opacity: disabled ? 0.5 : 1,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.thumb,
            {
              transform: [{ translateX: thumbTranslateX }],
            },
          ]}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  track: {
    width: 42,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    padding: 2,
  },
  thumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    // Flat design - minimal shadow for depth only on iOS
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 0.5 },
        shadowOpacity: 0.15,
        shadowRadius: 0.5,
      },
      android: {
        elevation: 0,
      },
    }),
  },
});

