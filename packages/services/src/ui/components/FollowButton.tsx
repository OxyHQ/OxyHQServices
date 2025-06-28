import React, { useEffect, useCallback } from 'react';
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
import { useDispatch, useSelector } from 'react-redux';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import {
  toggleFollowUser,
  setFollowingStatus,
  clearFollowError,
  fetchFollowStatus
} from '../store';
import type { RootState, AppDispatch } from '../store';

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

  /**
   * Whether to prevent default action and stop event propagation
   * Useful when the button is inside links or other pressable containers
   * @default true
   */
  preventParentActions?: boolean;

  /**
   * Custom onPress handler - if provided, will override default follow/unfollow behavior
   * Event object is passed to allow for preventDefault/stopPropagation
   */
  onPress?: (event: any) => void;
}

/**
 * An animated follow button with interactive state changes and preventDefault support
 * Uses Redux for state management to ensure all buttons with the same user ID stay synchronized
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
 * 
 * // Inside a pressable container (prevents parent actions)
 * <TouchableOpacity onPress={() => navigateToProfile()}>
 *   <View>
 *     <Text>User Profile</Text>
 *     <FollowButton 
 *       userId="123" 
 *       preventParentActions={true} // Default: true
 *     />
 *   </View>
 * </TouchableOpacity>
 * 
 * // Custom onPress handler
 * <FollowButton 
 *   userId="123" 
 *   onPress={(event) => {
 *     event.preventDefault(); // Custom preventDefault
 *     // Custom logic here
 *   }}
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
  preventParentActions = true,
  onPress,
}) => {
  const dispatch = useDispatch();
  const { oxyServices, isAuthenticated } = useOxy();

  // Optimized single selector to prevent multiple re-renders with defensive checks
  const followState = useSelector((state: RootState) => {
    // Defensive check to handle cases where follow state might not be initialized yet
    if (!state.follow) {
      return {
        isFollowing: initiallyFollowing ?? false,
        isLoading: false,
        error: null
      };
    }

    return {
      isFollowing: state.follow.followingUsers?.[userId] ?? initiallyFollowing ?? false,
      isLoading: state.follow.loadingUsers?.[userId] ?? false,
      error: state.follow.errors?.[userId] ?? null
    };
  });

  // Whether the follow status has been loaded from the store with defensive check
  const isStatusKnown = useSelector((state: RootState) => {
    if (!state.follow?.followingUsers) {
      return false;
    }
    return Object.prototype.hasOwnProperty.call(state.follow.followingUsers, userId);
  });

  const { isFollowing, isLoading, error } = followState;

  // Animation values
  const animationProgress = useSharedValue(isFollowing ? 1 : 0);
  const scale = useSharedValue(1);

  // Initialize Redux state with initial value if not already set
  useEffect(() => {
    if (userId && !isStatusKnown) {
      // Set the initial state regardless of whether initiallyFollowing is defined
      const initialState = initiallyFollowing ?? false;
      dispatch(setFollowingStatus({ userId, isFollowing: initialState }));
    }
  }, [userId, initiallyFollowing, isStatusKnown, dispatch]);

  // Fetch latest follow status from backend on mount if authenticated
  // This runs separately and will overwrite the initial state with actual data
  useEffect(() => {
    if (userId && isAuthenticated) {
      dispatch(fetchFollowStatus({ userId, oxyServices }));
    }
  }, [userId, oxyServices, isAuthenticated, dispatch]);

  // Update the animation value when isFollowing changes
  useEffect(() => {
    animationProgress.value = withTiming(isFollowing ? 1 : 0, {
      duration: 300,
      easing: Easing.bezier(0.25, 0.1, 0.25, 1),
    });
  }, [isFollowing]); // Removed animationProgress from dependencies as it's stable

  // Show error toast when error occurs
  useEffect(() => {
    if (error) {
      toast.error(error);
      dispatch(clearFollowError(userId));
    }
  }, [error]); // Removed userId and dispatch to prevent unnecessary runs

  // The button press handler with preventDefault support - memoized to prevent recreation
  const handlePress = useCallback(async (event?: any) => {
    // Prevent parent actions if enabled (e.g., if inside a link or pressable container)
    if (preventParentActions && event) {
      // For React Native Web compatibility
      if (Platform.OS === 'web' && event.preventDefault) {
        event.preventDefault();
      }

      // Stop event propagation to prevent parent TouchableOpacity/Pressable actions
      if (event.stopPropagation) {
        event.stopPropagation();
      }

      // For React Native, prevent gesture bubbling
      if (event.nativeEvent && event.nativeEvent.stopPropagation) {
        event.nativeEvent.stopPropagation();
      }
    }

    // If custom onPress is provided, use it instead of default behavior
    if (onPress) {
      onPress(event);
      return;
    }

    if (disabled || followState.isLoading) return;

    // Check if user is authenticated - show toast instead of disabling
    if (!isAuthenticated) {
      toast.error('Please sign in to follow users');
      return;
    }

    // Touch feedback animation
    scale.value = withSpring(0.95, { damping: 10 }, () => {
      scale.value = withSpring(1);
    });

    try {
      // Dispatch the async action to follow/unfollow
      const result = await dispatch(toggleFollowUser({
        userId,
        oxyServices,
        isCurrentlyFollowing: followState.isFollowing
      })).unwrap();

      // Call the callback if provided
      if (onFollowChange) {
        onFollowChange(result.isFollowing);
      }

      // Show success toast
      toast.success(result.isFollowing ? 'Following user!' : 'Unfollowed user');
    } catch (error: any) {
      console.error('Follow action failed:', error);

      // Show user-friendly error messages for state mismatches
      const errorMessage = error?.toString() || 'Unknown error';
      if (errorMessage.includes('State synced with backend')) {
        toast.info('Status updated. Please try again.');
      } else {
        toast.error(`Failed to ${followState.isFollowing ? 'unfollow' : 'follow'} user. Please try again.`);
      }
    }
  }, [
    preventParentActions,
    onPress,
    disabled,
    followState.isLoading,
    followState.isFollowing,
    isAuthenticated,
    scale,
    dispatch,
    userId,
    oxyServices,
    onFollowChange
  ]);

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
      disabled={disabled || isLoading}
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