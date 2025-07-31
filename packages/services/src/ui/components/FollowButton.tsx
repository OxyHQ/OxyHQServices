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
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { useFollow } from '../hooks/useFollow';
import { useThemeColors } from '../styles/theme';

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
  const { oxyServices, isAuthenticated } = useOxy();
  const colors = useThemeColors(theme);
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
  }, [isFollowing, animationProgress]);

  // Button press handler
  const handlePress = useCallback(async (event: any) => {
    if (preventParentActions && event && event.preventDefault) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (disabled || isLoading) return;
    try {
      await toggleFollow?.();
      if (onFollowChange) onFollowChange(!isFollowing);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to update follow status');
    }
  }, [disabled, isLoading, toggleFollow, onFollowChange, isFollowing, preventParentActions]);

  // Get button style based on size and follow state
  const getButtonStyle = (): StyleProp<ViewStyle> => {
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

    // State-specific colors
    let stateStyle = {};
    if (isFollowing) {
      stateStyle = {
        backgroundColor: colors.primary,
        borderColor: colors.primary,
        shadowColor: colors.primary,
      };
    } else {
      stateStyle = {
        backgroundColor: colors.background,
        borderColor: colors.border,
        shadowColor: colors.border,
      };
    }

    return [baseStyle, sizeStyle, stateStyle, style];
  };

  // Get text style based on size and follow state
  const getTextStyle = (): StyleProp<TextStyle> => {
    const baseTextStyle = {
      fontFamily: fontFamilies.phuduSemiBold,
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

    // State-specific text color
    const textColor = isFollowing ? '#FFFFFF' : colors.text;

    return [baseTextStyle, sizeTextStyle, { color: textColor }, textStyle];
  };

  return (
    <TouchableOpacity
      style={getButtonStyle()}
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
        <Text style={getTextStyle()}>
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // Legacy styles kept for backward compatibility but not used in new implementation
  buttonSmall: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 16,
    minWidth: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonMedium: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 20,
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLarge: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 24,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  following: {
    backgroundColor: '#007AFF',
  },
  notFollowing: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  textSmall: {
    fontSize: 13,
    fontFamily: fontFamilies.phuduMedium,
  },
  textMedium: {
    fontSize: 15,
    fontFamily: fontFamilies.phuduMedium,
  },
  textLarge: {
    fontSize: 18,
    fontFamily: fontFamilies.phuduMedium,
  },
  textFollowing: {
    color: '#fff',
  },
  textNotFollowing: {
    color: '#007AFF',
  },
});

export { FollowButton };
export default FollowButton;