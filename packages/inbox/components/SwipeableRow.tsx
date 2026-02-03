/**
 * Gmail-style swipeable row wrapper for native platforms.
 * Swipe left: delete/trash. Swipe right: archive.
 * Shows colored background with icon during swipe.
 */

import React, { useCallback, useRef } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';

interface SwipeableRowProps {
  children: React.ReactNode;
  onArchive: () => void;
  onDelete: () => void;
}

function RightAction() {
  return (
    <View style={[styles.action, styles.deleteAction]}>
      <MaterialCommunityIcons name="delete-outline" size={24} color="#FFFFFF" />
    </View>
  );
}

function LeftAction() {
  return (
    <View style={[styles.action, styles.archiveAction]}>
      <MaterialCommunityIcons name="archive-outline" size={24} color="#FFFFFF" />
    </View>
  );
}

export function SwipeableRow({ children, onArchive, onDelete }: SwipeableRowProps) {
  const swipeableRef = useRef<Swipeable>(null);

  const handleSwipeLeft = useCallback(() => {
    swipeableRef.current?.close();
    onDelete();
  }, [onDelete]);

  const handleSwipeRight = useCallback(() => {
    swipeableRef.current?.close();
    onArchive();
  }, [onArchive]);

  if (Platform.OS === 'web') {
    return <>{children}</>;
  }

  return (
    <Swipeable
      ref={swipeableRef}
      renderLeftActions={LeftAction}
      renderRightActions={RightAction}
      onSwipeableOpen={(direction) => {
        if (direction === 'left') handleSwipeRight();
        else handleSwipeLeft();
      }}
      overshootLeft={false}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  action: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
  },
  archiveAction: {
    backgroundColor: '#34A853',
  },
  deleteAction: {
    backgroundColor: '#EA4335',
  },
});
