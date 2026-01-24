import type React from 'react';
import { useEffect, useCallback } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
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
import { toast } from '../../lib/sonner';
import { useFollow } from '../hooks/useFollow';
import { useThemeColors } from '../styles/theme';

// Create animated TouchableOpacity
const AnimatedTouchableOpacity = Animated.createAnimatedComponent(TouchableOpacity);
const AnimatedText = Animated.createAnimatedComponent(Text);

export interface FollowButtonProps {
  userId: string;
  initiallyFollowing?: boolean;
  size?: 'small' | 'medium' | 'large';
  onFollowChange?: (isFollowing: boolean) => void;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
  showLoadingState?: boolean;
  preventParentActions?: boolean;
  theme?: 'light' | 'dark';
}

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
  theme = 'light',
}) => {
  const { oxyServices, isAuthenticated, user: currentUser } = useOxy();
  const colors = useThemeColors(theme);

  // Safety check: Don't render follow button on own profile
  // This provides a fallback in case parent components don't handle this check
  // Normalize IDs by trimming whitespace and comparing as strings
  const normalizeId = (id: string | undefined | null): string => {
    if (!id) return '';
    return String(id).trim();
  };

  const currentUserId = normalizeId(currentUser?.id);
  const targetUserId = normalizeId(userId);

  // Don't render if:
  // 1. Not authenticated (can't follow anyway)
  // 2. Viewing own profile (currentUser.id matches userId)
  if (!isAuthenticated || (currentUserId && targetUserId && currentUserId === targetUserId)) {
    return null;
  }
  const {
    isFollowing,
    isLoading,
    error,
    toggleFollow,
    setFollowStatus,
    fetchStatus,
    clearError,
  } = useFollow(userId);

  // Animation values
  const animationProgress = useSharedValue(isFollowing ? 1 : 0);
  const scale = useSharedValue(1);

  // Button press handler with animation
  const handlePress = useCallback(async (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (preventParentActions && event && event.preventDefault) {
      event.preventDefault();
      event.stopPropagation?.();
    }
    if (disabled || isLoading) return;

    // Press animation
    scale.value = withTiming(0.95, { duration: 100 }, (finished) => {
      if (finished) {
        scale.value = withSpring(1, { damping: 15, stiffness: 200 });
      }
    });

    try {
      await toggleFollow?.();
      if (onFollowChange) onFollowChange(!isFollowing);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(error.message || 'Failed to update follow status');
    }
  }, [disabled, isLoading, toggleFollow, onFollowChange, isFollowing, preventParentActions, scale]);

  // Initialize Zustand state with initial value if not already set
  useEffect(() => {
    if (userId && !isFollowing && initiallyFollowing) {
      setFollowStatus?.(initiallyFollowing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, initiallyFollowing]);

  // Fetch latest follow status from backend on mount if authenticated
  useEffect(() => {
    if (userId && isAuthenticated) {
      fetchStatus?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, oxyServices, isAuthenticated]);

  // Animate button on follow/unfollow
  useEffect(() => {
    animationProgress.value = withTiming(isFollowing ? 1 : 0, { duration: 300, easing: Easing.inOut(Easing.ease) });
  }, [isFollowing]);

  // Animated styles for better performance
  const animatedButtonStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
      backgroundColor: interpolateColor(
        animationProgress.value,
        [0, 1],
        [colors.background, colors.primary]
      ),
      borderColor: interpolateColor(
        animationProgress.value,
        [0, 1],
        [colors.border, colors.primary]
      ),
    };
  }, [colors]);

  const animatedTextStyle = useAnimatedStyle(() => {
    return {
      color: interpolateColor(
        animationProgress.value,
        [0, 1],
        [colors.text, '#FFFFFF']
      ),
    };
  }, [colors]);

  // Get base button style (without state-specific colors since they're animated)
  const getBaseButtonStyle = (): StyleProp<ViewStyle> => {
    const baseStyle = {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      ...Platform.select({
        web: {
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        },
        default: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.1,
          shadowRadius: 4,
          elevation: 2,
        }
      }),
    };

    // Size-specific styles
    let sizeStyle = {};
    if (size === 'small') {
      sizeStyle = {
        paddingVertical: 6,
        paddingHorizontal: 12,
        minWidth: 70,
        borderRadius: 35,
      };
    } else if (size === 'large') {
      sizeStyle = {
        paddingVertical: 12,
        paddingHorizontal: 24,
        minWidth: 120,
        borderRadius: 35,
      };
    } else {
      // medium
      sizeStyle = {
        paddingVertical: 8,
        paddingHorizontal: 16,
        minWidth: 90,
        borderRadius: 35,
      };
    }

    return [baseStyle, sizeStyle, style];
  };

  // Get base text style (without state-specific colors since they're animated)
  const getBaseTextStyle = (): StyleProp<TextStyle> => {
    const baseTextStyle = {
      fontFamily: fontFamilies.interSemiBold,
      fontWeight: '600' as const,
    };

    // Size-specific text styles
    let sizeTextStyle = {};
    if (size === 'small') {
      sizeTextStyle = { fontSize: 13 };
    } else if (size === 'large') {
      sizeTextStyle = { fontSize: 16 };
    } else {
      // medium
      sizeTextStyle = { fontSize: 15 };
    }

    return [baseTextStyle, sizeTextStyle, textStyle];
  };

  return (
    <AnimatedTouchableOpacity
      style={[getBaseButtonStyle(), animatedButtonStyle]}
      onPress={handlePress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
    >
      {showLoadingState && isLoading ? (
        <ActivityIndicator
          size={size === 'small' ? 'small' : 'small'}
          color={isFollowing ? '#FFFFFF' : colors.primary}
        />
      ) : (
        <AnimatedText style={[getBaseTextStyle(), animatedTextStyle]}>
          {isFollowing ? 'Following' : 'Follow'}
        </AnimatedText>
      )}
    </AnimatedTouchableOpacity>
  );
};


export { FollowButton };
export default FollowButton;