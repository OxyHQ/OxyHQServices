import React, { useEffect, useCallback, useMemo, useState, memo } from 'react';
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
import { toast } from '@oxyhq/bloom';
import { useFollow, useFollowForButton } from '../hooks/useFollow';
import { useTheme } from '@oxyhq/bloom/theme';
import type { OxyServices, BulkFollowResult } from '@oxyhq/core';

const DEFAULT_FOLLOW_ALL_LABEL = 'Follow all';
const DEFAULT_FOLLOWED_ALL_LABEL = 'Following';

/** Props shared by both single- and multi-user follow modes. */
interface FollowButtonBaseProps {
  size?: 'small' | 'medium' | 'large';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  disabled?: boolean;
  showLoadingState?: boolean;
  preventParentActions?: boolean;
  theme?: 'light' | 'dark';
  onFollowChange?: (isFollowing: boolean) => void;
}

/** Single-user mode — follows/unfollows one user (existing behavior). */
export interface SingleFollowButtonProps extends FollowButtonBaseProps {
  userId: string;
  initiallyFollowing?: boolean;
  userIds?: never;
}

/** Multi-user mode — follows MANY users in one "Follow all" action (follow-only). */
export interface MultiFollowButtonProps extends FollowButtonBaseProps {
  userIds: string[];
  initiallyAllFollowing?: boolean;
  followAllLabel?: string;
  followedAllLabel?: string;
  onBulkFollow?: (result: BulkFollowResult) => void;
  userId?: never;
}

/**
 * FollowButton accepts EITHER single-user mode (`userId`) or multi-user mode
 * (`userIds`), never both. Existing `{ userId, ... }` callers remain valid.
 */
export type FollowButtonProps = SingleFollowButtonProps | MultiFollowButtonProps;

const isMultiMode = (props: FollowButtonProps): props is MultiFollowButtonProps =>
  'userIds' in props && Array.isArray(props.userIds);

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
}: SingleFollowButtonProps & { oxyServices: OxyServices }) {
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
          color={isFollowing ? colors.text : colors.negativeForeground}
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

const FollowButtonMultiInner = memo(function FollowButtonMultiInner({
  userIds,
  initiallyAllFollowing = false,
  size = 'medium',
  followAllLabel = DEFAULT_FOLLOW_ALL_LABEL,
  followedAllLabel = DEFAULT_FOLLOWED_ALL_LABEL,
  onFollowChange,
  onBulkFollow,
  style,
  textStyle,
  disabled = false,
  showLoadingState = true,
  preventParentActions = true,
}: MultiFollowButtonProps) {
  const { colors } = useTheme();
  const follow = useFollow(userIds);
  const followAllUsers = 'followAllUsers' in follow ? follow.followAllUsers : undefined;
  const isAnyLoading = 'isAnyLoading' in follow ? follow.isAnyLoading : false;

  const [allFollowing, setAllFollowing] = useState(initiallyAllFollowing);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isLoading = isSubmitting || isAnyLoading;

  const handlePress = useCallback(async (event?: { preventDefault?: () => void; stopPropagation?: () => void }) => {
    if (preventParentActions && event?.preventDefault) {
      event.preventDefault();
      event.stopPropagation?.();
    }
    if (disabled || isLoading || allFollowing || !followAllUsers) return;

    setIsSubmitting(true);
    try {
      const result = await followAllUsers();
      const allAlreadyFollowing = result.followedCount === 0
        && result.results.length > 0
        && result.results.every((entry) => entry.alreadyFollowing);
      const anyFollowed = result.followedCount > 0
        || result.results.some((entry) => entry.success || entry.alreadyFollowing);

      if (allAlreadyFollowing || anyFollowed) {
        setAllFollowing(true);
        onFollowChange?.(true);
      }
      onBulkFollow?.(result);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(error.message || 'Failed to update follow status');
    } finally {
      setIsSubmitting(false);
    }
  }, [disabled, isLoading, allFollowing, followAllUsers, onFollowChange, onBulkFollow, preventParentActions]);

  const baseButtonStyle = getBaseButtonStyle(size, style);
  const baseTextStyle = getBaseTextStyle(size, textStyle);

  return (
    <TouchableOpacity
      className={allFollowing
        ? 'bg-background border-border'
        : 'bg-primary border-primary'
      }
      style={baseButtonStyle}
      onPress={handlePress}
      disabled={disabled || isLoading || allFollowing}
      activeOpacity={0.8}
    >
      {showLoadingState && isLoading ? (
        <ActivityIndicator
          size="small"
          color={allFollowing ? colors.text : colors.negativeForeground}
        />
      ) : (
        <Text
          className={allFollowing ? 'text-foreground' : 'text-primary-foreground'}
          style={baseTextStyle}
        >
          {allFollowing ? followedAllLabel : followAllLabel}
        </Text>
      )}
    </TouchableOpacity>
  );
});

const FollowButton: React.FC<FollowButtonProps> = (props) => {
  const { oxyServices, canUsePrivateApi, user: currentUser } = useOxy();

  const currentUserId = currentUser?.id ? String(currentUser.id).trim() : '';

  const rawUserIds = isMultiMode(props) ? props.userIds : null;

  // Multi-user mode: dedupe, trim, drop the current user, and bail if empty.
  const multiUserIds = useMemo(() => {
    if (!rawUserIds) return [];
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of rawUserIds) {
      const id = raw ? String(raw).trim() : '';
      if (!id || id === currentUserId || seen.has(id)) continue;
      seen.add(id);
      cleaned.push(id);
    }
    return cleaned;
  }, [rawUserIds, currentUserId]);

  if (!canUsePrivateApi) {
    return null;
  }

  if (isMultiMode(props)) {
    if (multiUserIds.length === 0) {
      return null;
    }
    return (
      <FollowButtonMultiInner
        {...props}
        userIds={multiUserIds}
      />
    );
  }

  const targetUserId = props.userId ? String(props.userId).trim() : '';
  if (!targetUserId || (currentUserId && currentUserId === targetUserId)) {
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
