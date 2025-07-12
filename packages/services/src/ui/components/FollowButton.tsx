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
}) => {
  const { oxyServices, isAuthenticated } = useOxy();
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

  // Button styles
  const getButtonStyle = (): StyleProp<ViewStyle> => {
    let baseStyle = styles.buttonMedium;
    if (size === 'small') baseStyle = styles.buttonSmall;
    if (size === 'large') baseStyle = styles.buttonLarge;
    return [baseStyle, isFollowing ? styles.following : styles.notFollowing, style];
  };

  const getTextStyle = (): StyleProp<TextStyle> => {
    let baseStyle = styles.textMedium;
    if (size === 'small') baseStyle = styles.textSmall;
    if (size === 'large') baseStyle = styles.textLarge;
    return [baseStyle, isFollowing ? styles.textFollowing : styles.textNotFollowing, textStyle];
  };

  return (
    <TouchableOpacity
      style={getButtonStyle()}
      onPress={handlePress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
    >
      {showLoadingState && isLoading ? (
        <ActivityIndicator size={size === 'small' ? 'small' : 'large'} color={isFollowing ? '#fff' : '#007AFF'} />
      ) : (
        <Text style={getTextStyle()}>{isFollowing ? 'Following' : 'Follow'}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
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