import React, { useState, useEffect } from 'react';
import { 
  TouchableOpacity, 
  Text, 
  StyleSheet, 
  ViewStyle, 
  TextStyle, 
  StyleProp, 
  Platform,
  ActivityIndicator
} from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withSpring, 
  interpolateColor,
  Easing, 
  withTiming 
} from 'react-native-reanimated';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';

export interface FollowButtonProps {
  /**
   * The user ID to follow/unfollow
   */
  userId: string;

  /**
   * Initial follow state, if known
   * @default false 
   */
  initiallyFollowing?: boolean;

  /**
   * Button size
   * @default 'medium'
   */
  size?: 'small' | 'medium' | 'large';

  /**
   * Custom callback when follow/unfollow action happens
   */
  onFollowChange?: (isFollowing: boolean) => void;

  /**
   * Additional styles for the button container
   */
  style?: StyleProp<ViewStyle>;

  /**
   * Additional styles for the button text
   */
  textStyle?: StyleProp<TextStyle>;

  /**
   * Whether to disable the button
   * @default false
   */
  disabled?: boolean;
  
  /**
   * Whether to show loading indicator during API calls
   * @default true
   */
  showLoadingState?: boolean;
}

/**
 * An animated follow button with interactive state changes
 * 
 * @example
 * ```tsx
 * // Basic usage
 * <FollowButton userId="123" />
 * 
 * // With custom styling
 * <FollowButton 
 *   userId="123" 
 *   initiallyFollowing={true}
 *   size="large"
 *   style={{ borderRadius: 12 }}
 *   onFollowChange={(isFollowing) => console.log(`User is now ${isFollowing ? 'followed' : 'unfollowed'}`)}
 * />
 * ```
 */
const FollowButton: React.FC<FollowButtonProps> = ({
  userId,
  initiallyFollowing = false,
  size = 'medium',
  onFollowChange,
  style,
  textStyle,
  disabled = false,
  showLoadingState = true,
}) => {
  const { oxyServices, isAuthenticated } = useOxy();
  const [isFollowing, setIsFollowing] = useState(initiallyFollowing);
  const [isLoading, setIsLoading] = useState(false);

  // Animation values
  const animationProgress = useSharedValue(initiallyFollowing ? 1 : 0);
  const scale = useSharedValue(1);
  
  // Update the animation value when isFollowing changes
  useEffect(() => {
    animationProgress.value = withTiming(isFollowing ? 1 : 0, {
      duration: 300,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [isFollowing, animationProgress]);

  // The button press handler
  const handlePress = async () => {
    if (disabled || isLoading || !isAuthenticated) return;
    
    // Touch feedback animation
    scale.value = withSpring(0.95, { damping: 10 }, () => {
      scale.value = withSpring(1);
    });

    setIsLoading(true);

    try {
      // This should be replaced with actual API call to your services
      if (isFollowing) {
        // Unfollow API call would go here
        // await oxyServices.user.unfollowUser(userId);
        console.log(`Unfollowing user: ${userId}`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulating API call
      } else {
        // Follow API call would go here
        // await oxyServices.user.followUser(userId);
        console.log(`Following user: ${userId}`);
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulating API call
      }

      // Toggle following state with animation
      const newFollowingState = !isFollowing;
      setIsFollowing(newFollowingState);
      
      // Call the callback if provided
      if (onFollowChange) {
        onFollowChange(newFollowingState);
      }
    } catch (error) {
      console.error('Follow action failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Animated styles for the button
  const animatedButtonStyle = useAnimatedStyle(() => {
    const backgroundColor = interpolateColor(
      animationProgress.value,
      [0, 1],
      ['#d169e5', '#FFFFFF']
    );
    
    const borderColor = interpolateColor(
      animationProgress.value,
      [0, 1],
      ['#d169e5', '#d169e5']
    );

    // Add a slight scaling effect during the transition
    const transitionScale = 1 + 0.05 * Math.sin(animationProgress.value * Math.PI);

    return {
      backgroundColor,
      borderColor,
      borderWidth: 1,
      transform: [
        { scale: scale.value * transitionScale },
      ],
    };
  });

  // Animated styles for the text
  const animatedTextStyle = useAnimatedStyle(() => {
    const color = interpolateColor(
      animationProgress.value,
      [0, 1],
      ['#FFFFFF', '#d169e5']
    );

    return {
      color,
    };
  });

  // Get size-specific styles
  const getSizeStyles = () => {
    switch (size) {
      case 'small':
        return {
          button: {
            paddingVertical: 6,
            paddingHorizontal: 12,
          } as ViewStyle,
          text: {
            fontSize: 12,
          } as TextStyle,
        };
      case 'large':
        return {
          button: {
            paddingVertical: 12,
            paddingHorizontal: 24,
          } as ViewStyle,
          text: {
            fontSize: 18,
          } as TextStyle,
        };
      default: // medium
        return {
          button: {
            paddingVertical: 8,
            paddingHorizontal: 16,
          } as ViewStyle,
          text: {
            fontSize: 14,
          } as TextStyle,
        };
    }
  };

  const sizeStyles = getSizeStyles();

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      disabled={disabled || isLoading || !isAuthenticated}
    >
      <Animated.View
        style={[
          styles.button,
          sizeStyles.button,
          animatedButtonStyle,
          style,
        ]}
      >
        {isLoading && showLoadingState ? (
          <ActivityIndicator 
            size="small" 
            color={isFollowing ? '#d169e5' : '#FFFFFF'} 
          />
        ) : (
          <Animated.Text
            style={[
              styles.text,
              sizeStyles.text,
              animatedTextStyle,
              textStyle,
            ]}
          >
            {isFollowing ? 'Following' : 'Follow'}
          </Animated.Text>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    borderRadius: 100,
  },
  text: {
    fontFamily: Platform.select({
      web: 'Phudu',
      default: fontFamilies.phuduSemiBold,
    }),
    fontWeight: Platform.OS === 'web' ? '600' : undefined,
    textAlign: 'center',
  },
});

export default FollowButton;