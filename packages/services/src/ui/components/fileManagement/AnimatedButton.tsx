import React, { useEffect, useRef } from 'react';
import { TouchableOpacity, Animated, Easing } from 'react-native';
// @ts-ignore - MaterialCommunityIcons is available at runtime
import { MaterialCommunityIcons } from '@expo/vector-icons';

interface AnimatedButtonProps {
  isSelected: boolean;
  onPress: () => void;
  icon: string;
  primaryColor: string;
  textColor: string;
  style: any;
}

/**
 * Animated button component for smooth selection transitions
 * Used in file management views for view mode toggles
 */
export const AnimatedButton: React.FC<AnimatedButtonProps> = ({
  isSelected,
  onPress,
  icon,
  primaryColor,
  textColor,
  style,
}) => {
  const animatedValue = useRef(new Animated.Value(isSelected ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(animatedValue, {
      toValue: isSelected ? 1 : 0,
      duration: 200,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [isSelected, animatedValue]);

  const backgroundColor = animatedValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['transparent', primaryColor],
  });

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Animated.View style={[style, { backgroundColor }]}>
        <Animated.View>
          <MaterialCommunityIcons
            name={icon as any}
            size={16}
            color={isSelected ? '#FFFFFF' : textColor}
          />
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
};
