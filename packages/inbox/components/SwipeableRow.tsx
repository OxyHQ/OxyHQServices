/**
 * Gmail-style swipeable row wrapper for native platforms.
 * Swipe left: delete/trash. Swipe right: archive.
 * Shows a colored background with icon during swipe.
 *
 * Built on `ReanimatedSwipeable` (the supported successor to
 * `react-native-gesture-handler`'s legacy `Swipeable`, which is deprecated as
 * of gesture-handler 2.18+).
 */

import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ReanimatedSwipeable, {
  type SwipeableMethods,
  SwipeDirection,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { useColors } from '@/constants/theme';

interface SwipeableRowProps {
  children: React.ReactNode;
  onArchive: () => void;
  onDelete: () => void;
}

interface ActionProps {
  backgroundColor: string;
}

function RightAction({ backgroundColor }: ActionProps) {
  return (
    <View style={[styles.action, { backgroundColor }]}>
      <MaterialCommunityIcons name="delete-outline" size={24} color="#FFFFFF" />
    </View>
  );
}

function LeftAction({ backgroundColor }: ActionProps) {
  return (
    <View style={[styles.action, { backgroundColor }]}>
      <MaterialCommunityIcons name="archive-outline" size={24} color="#FFFFFF" />
    </View>
  );
}

export function SwipeableRow({ children, onArchive, onDelete }: SwipeableRowProps) {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const colors = useColors();

  const handleOpen = useCallback(
    (direction: SwipeDirection) => {
      swipeableRef.current?.close();
      if (direction === SwipeDirection.LEFT) {
        onArchive();
      } else {
        onDelete();
      }
    },
    [onArchive, onDelete],
  );

  if (Platform.OS === 'web') {
    return <>{children}</>;
  }

  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      renderLeftActions={() => <LeftAction backgroundColor={colors.swipeArchive} />}
      renderRightActions={() => <RightAction backgroundColor={colors.swipeDelete} />}
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
