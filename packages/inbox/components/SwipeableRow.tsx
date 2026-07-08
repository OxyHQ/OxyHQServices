/**
 * Gmail-style swipeable row wrapper for native platforms.
 *
 * The row is behaviour-agnostic: it renders whichever swipe actions the user
 * configured (`leftAction` / `rightAction`) and delegates the actual work to
 * the parent via `onAction(action, messageId)`. It knows nothing about
 * mutations or the message cache — `InboxList` wires the handlers through
 * `useMessageActions`.
 *
 * Built on `ReanimatedSwipeable` (the supported successor to
 * `react-native-gesture-handler`'s legacy `Swipeable`, which is deprecated as
 * of gesture-handler 2.18+).
 *
 * Web: swipe gestures are not supported, so the children render as-is.
 */

import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ReanimatedSwipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { useColors } from '@/constants/theme';
import { getSwipeActionConfig, type SwipeActionConfig } from '@/constants/swipeActions';
import type { SwipeAction } from '@/contexts/inbox-prefs-context';

interface SwipeableRowProps {
  children: React.ReactNode;
  messageId: string;
  /** Action revealed by a left-to-right swipe. */
  leftAction: SwipeAction;
  /** Action revealed by a right-to-left swipe. */
  rightAction: SwipeAction;
  onAction: (action: SwipeAction, messageId: string) => void;
}

function ActionPane({
  config,
  backgroundColor,
}: {
  config: SwipeActionConfig;
  backgroundColor: string;
}) {
  return (
    <View style={[styles.action, { backgroundColor }]}>
      <MaterialCommunityIcons name={config.icon} size={24} color="#FFFFFF" />
    </View>
  );
}

export function SwipeableRow({
  children,
  messageId,
  leftAction,
  rightAction,
  onAction,
}: SwipeableRowProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const colors = useColors();

  const leftConfig = getSwipeActionConfig(leftAction);
  const rightConfig = getSwipeActionConfig(rightAction);

  const handleOpen = useCallback(
    (direction: SwipeDirection) => {
      swipeableRef.current?.close();
      const action = direction === SwipeDirection.LEFT ? leftAction : rightAction;
      if (action === 'none') return;
      onAction(action, messageId);
    },
    [leftAction, rightAction, onAction, messageId],
  );

  // Web has no swipe gesture, and if both sides are disabled there's nothing
  // to render — pass the row straight through.
  if (Platform.OS === 'web' || (!leftConfig && !rightConfig)) {
    return <>{children}</>;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderLeftActions={
        leftConfig
          ? () => <ActionPane config={leftConfig} backgroundColor={colors[leftConfig.colorKey]} />
          : undefined
      }
      renderRightActions={
        rightConfig
          ? () => <ActionPane config={rightConfig} backgroundColor={colors[rightConfig.colorKey]} />
          : undefined
      }
      onSwipeableOpen={handleOpen}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
});
