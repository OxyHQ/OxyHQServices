import React, { useEffect, useCallback, memo } from 'react';
import {
  TouchableOpacity,
  Text,
  type ViewStyle,
  type TextStyle,
  type StyleProp,
  Platform,
  ActivityIndicator
} from 'react-native';
import { useOxy } from '../context/OxyContext';
import { fontFamilies } from '../styles/fonts';
import { toast } from '../../lib/sonner';
import { useFollowForButton } from '../hooks/useFollow';
import { useTheme } from '@oxyhq/bloom/theme';
import type { OxyServices } from '@oxyhq/core';

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
}: FollowButtonProps & { oxyServices: OxyServices }) {
  const { colors } = useTheme();

  const {
    isFollowing,
    isLoading,
    toggleFollow,
    setFollowStatus,
    fetchStatus,
  } = useFollowForButton(userId, oxyServices);

  const handlePress = useCallback(async (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (preventParentActions && event?.preventDefault) {
      event.preventDefault();
      event.stopPropagation?.();
    }
    if (disabled || isLoading) return;

    try {
      await toggleFollow();
      onFollowChange?.(!isFollowing);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(error.message || 'Failed to update follow status');
    }
  }, [disabled, isLoading, toggleFollow, onFollowChange, isFollowing, preventParentActions]);

  useEffect(() => {
    if (userId && !isFollowing && initiallyFollowing) {
      setFollowStatus(initiallyFollowing);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, initiallyFollowing]);

  useEffect(() => {
    if (userId) fetchStatus();
  }, [userId, fetchStatus]);

  const baseButtonStyle = getBaseButtonStyle(size, style);
  const baseTextStyle = getBaseTextStyle(size, textStyle);

  return (
    <TouchableOpacity
      className={isFollowing
        ? 'bg-background border-border'
        : 'bg-primary border-primary'
      }
      style={baseButtonStyle}
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
        <Text
          className={isFollowing ? 'text-foreground' : 'text-primary-foreground'}
          style={baseTextStyle}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </Text>
      )}
    </TouchableOpacity>
  );
});

const FollowButton: React.FC<FollowButtonProps> = (props) => {
  const { oxyServices, isAuthenticated, user: currentUser } = useOxy();

  const currentUserId = currentUser?.id ? String(currentUser.id).trim() : '';
  const targetUserId = props.userId ? String(props.userId).trim() : '';

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
