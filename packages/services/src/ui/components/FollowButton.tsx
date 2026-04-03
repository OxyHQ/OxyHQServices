import React, { useEffect, useCallback, memo } from 'react';
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
import { useFollowForButton } from '../hooks/useFollow';
import { useTheme } from '@oxyhq/bloom/theme';
import type { OxyServices } from '@oxyhq/core';

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

/**
 * Inner component that handles all hooks and rendering.
 *
 * Separated from the outer wrapper to avoid a Rules of Hooks violation.
 * The outer wrapper handles the auth/self-follow guard and returns null
 * before any hooks are called. This inner component always renders
 * (all hooks are called unconditionally).
 *
 * Receives oxyServices as a prop instead of calling useOxy(), so it does
 * not subscribe to the OxyContext. This is critical in list contexts where
 * N buttons would all re-render on any context change (session socket events,
 * token refreshes, etc.).
 */
const FollowButtonInner = memo(function FollowButtonInner({
  userId,
  oxyServices,
  initiallyFollowing = false,
  size = 'medium',
  onFollowChange,
  style,
  textStyle,
  disabled = false,
  showLoadingState = true,
  preventParentActions = true,
  theme: _theme = 'light',
}: FollowButtonProps & { oxyServices: OxyServices }) {
  const bloomTheme = useTheme();
  const colors = bloomTheme.colors;

  // Uses granular Zustand selectors — only re-renders when THIS user's data changes
  const {
    isFollowing,
    isLoading,
    toggleFollow,
    setFollowStatus,
    fetchStatus,
  } = useFollowForButton(userId, oxyServices);

  // Animation values
  const animationProgress = useSharedValue(isFollowing ? 1 : 0);
  const scale = useSharedValue(1);

  // Stable press handler — depends on primitives only
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
      await toggleFollow();
      if (onFollowChange) onFollowChange(!isFollowing);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(error.message || 'Failed to update follow status');
    }
  }, [disabled, isLoading, toggleFollow, onFollowChange, isFollowing, preventParentActions, scale]);

  // Set initial follow status on mount if provided and not already set
  useEffect(() => {
    if (userId && !isFollowing && initiallyFollowing) {
      setFollowStatus(initiallyFollowing);
    }
    // Intentional: only run on mount with initial values
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, initiallyFollowing]);

  // Fetch latest follow status from backend on mount
  useEffect(() => {
    if (userId) {
      fetchStatus();
    }
  }, [userId, fetchStatus]);

  // Animate button on follow/unfollow
  useEffect(() => {
    animationProgress.value = withTiming(isFollowing ? 1 : 0, { duration: 300, easing: Easing.inOut(Easing.ease) });
  }, [isFollowing, animationProgress]);

  // Animated styles
  // When not following (progress=0): primary filled button (bg-primary, text white)
  // When following (progress=1): outlined button (bg-background, border-border, text-foreground)
  const animatedButtonStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
      backgroundColor: interpolateColor(
        animationProgress.value,
        [0, 1],
        [colors.primary, colors.background]
      ),
      borderColor: interpolateColor(
        animationProgress.value,
        [0, 1],
        [colors.primary, colors.border]
      ),
    };
  }, [colors]);

  const animatedTextStyle = useAnimatedStyle(() => {
    return {
      color: interpolateColor(
        animationProgress.value,
        [0, 1],
        ['#FFFFFF', colors.text]
      ),
    };
  }, [colors]);

  const baseButtonStyle = getBaseButtonStyle(size, style);
  const baseTextStyle = getBaseTextStyle(size, textStyle);

  return (
    <AnimatedTouchableOpacity
      style={[baseButtonStyle, animatedButtonStyle]}
      onPress={handlePress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
    >
      {showLoadingState && isLoading ? (
        <ActivityIndicator
          size="small"
          color={isFollowing ? colors.text : '#FFFFFF'}
        />
      ) : (
        <AnimatedText style={[baseTextStyle, animatedTextStyle]}>
          {isFollowing ? 'Following' : 'Follow'}
        </AnimatedText>
      )}
    </AnimatedTouchableOpacity>
  );
});

/**
 * Outer wrapper that handles the "should we render?" check.
 *
 * This is the ONLY place useOxy() is called — to check authentication and
 * get the current user ID for the self-follow guard. The oxyServices instance
 * is passed down as a prop to the inner component, which avoids subscribing
 * to the full OxyContext.
 *
 * The early return happens BEFORE the inner component mounts, so the inner
 * component's hooks are never called conditionally (no Rules of Hooks violation).
 */
const FollowButton: React.FC<FollowButtonProps> = (props) => {
  const { oxyServices, isAuthenticated, user: currentUser } = useOxy();

  const currentUserId = currentUser?.id ? String(currentUser.id).trim() : '';
  const targetUserId = props.userId ? String(props.userId).trim() : '';

  // Don't render if not authenticated or viewing own profile
  if (!isAuthenticated || !targetUserId || (currentUserId && currentUserId === targetUserId)) {
    return null;
  }

  return (
    <FollowButtonInner
      {...props}
      userId={targetUserId}
      oxyServices={oxyServices}
    />
  );
};

// Pure helper functions (no hooks, no state) extracted outside the component
function getBaseButtonStyle(size: string, style?: StyleProp<ViewStyle>): StyleProp<ViewStyle> {
  const baseStyle: ViewStyle = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    ...Platform.select({
      web: {},
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
      }
    }),
  };

  let sizeStyle: ViewStyle;
  if (size === 'small') {
    sizeStyle = { paddingVertical: 6, paddingHorizontal: 12, minWidth: 70, borderRadius: 35 };
  } else if (size === 'large') {
    sizeStyle = { paddingVertical: 12, paddingHorizontal: 24, minWidth: 120, borderRadius: 35 };
  } else {
    sizeStyle = { paddingVertical: 8, paddingHorizontal: 16, minWidth: 90, borderRadius: 35 };
  }

  return [baseStyle, sizeStyle, style];
}

function getBaseTextStyle(size: string, textStyle?: StyleProp<TextStyle>): StyleProp<TextStyle> {
  const baseTextStyle: TextStyle = {
    fontFamily: fontFamilies.interSemiBold,
    fontWeight: '600',
  };

  let sizeTextStyle: TextStyle;
  if (size === 'small') {
    sizeTextStyle = { fontSize: 13 };
  } else if (size === 'large') {
    sizeTextStyle = { fontSize: 16 };
  } else {
    sizeTextStyle = { fontSize: 15 };
  }

  return [baseTextStyle, sizeTextStyle, textStyle];
}

export { FollowButton };
export default FollowButton;
