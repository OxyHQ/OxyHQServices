import React, { forwardRef, useImperativeHandle, useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Modal,
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Platform,
  StatusBar,
} from 'react-native';

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

export interface BottomSheetModalProps {
  children?: React.ReactNode;
  snapPoints?: (string | number)[];
  index?: number;
  enablePanDownToClose?: boolean;
  backdropComponent?: React.ComponentType<any>;
  handleComponent?: React.ComponentType<any>;
  backgroundStyle?: any;
  handleIndicatorStyle?: any;
  onChange?: (index: number) => void;
  onAnimate?: (fromIndex: number, toIndex: number) => void;
  keyboardBehavior?: 'interactive' | 'fillParent' | 'extend';
  keyboardBlurBehavior?: 'none' | 'restore';
  android_keyboardInputMode?: 'adjustPan' | 'adjustResize';
  enableOverDrag?: boolean;
  enableContentPanningGesture?: boolean;
  enableHandlePanningGesture?: boolean;
  overDragResistanceFactor?: number;
  enableBlurKeyboardOnGesture?: boolean;
}

export interface BottomSheetModalRef {
  present: () => void;
  dismiss: () => void;
  expand: () => void;
  collapse: () => void;
  close: () => void;
  snapToIndex: (index: number) => void;
  snapToPosition: (position: string | number) => void;
}

// Helper function to convert snap point to actual height
const getSnapPointHeight = (snapPoint: string | number): number => {
  if (typeof snapPoint === 'string') {
    const percentage = parseInt(snapPoint.replace('%', ''));
    return (SCREEN_HEIGHT * percentage) / 100;
  }
  return snapPoint;
};

export const BottomSheetModal = forwardRef<BottomSheetModalRef, BottomSheetModalProps>(
  ({
    children,
    snapPoints = ['50%', '90%'],
    index = 0,
    enablePanDownToClose = true,
    backdropComponent: BackdropComponent,
    handleComponent: HandleComponent,
    backgroundStyle,
    handleIndicatorStyle,
    onChange,
    onAnimate,
    keyboardBehavior = 'interactive',
    keyboardBlurBehavior = 'restore',
    android_keyboardInputMode = 'adjustResize',
    enableOverDrag = true,
    enableContentPanningGesture = true,
    enableHandlePanningGesture = true,
    overDragResistanceFactor = 2.5,
    enableBlurKeyboardOnGesture = true,
  }, ref) => {
    const [isVisible, setIsVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(index);
    const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    // Get the height for current snap point
    const getCurrentSnapHeight = useCallback(() => {
      if (currentIndex >= 0 && currentIndex < snapPoints.length) {
        return getSnapPointHeight(snapPoints[currentIndex]);
      }
      return getSnapPointHeight(snapPoints[0]);
    }, [currentIndex, snapPoints]);

    // Get the translateY value for a specific snap point
    const getTranslateYForIndex = useCallback((targetIndex: number) => {
      const targetHeight = getSnapPointHeight(snapPoints[targetIndex]);
      return SCREEN_HEIGHT - targetHeight;
    }, [snapPoints]);

    // Animation to show/hide the modal
    const animateToPosition = useCallback((toIndex: number, onComplete?: () => void) => {
      const fromIndex = currentIndex;
      
      if (onAnimate) {
        onAnimate(fromIndex, toIndex);
      }

      if (toIndex === -1) {
        // Dismiss animation
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            duration: 300,
            useNativeDriver: false, // Don't use native driver due to layout properties
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            duration: 300,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]).start(() => {
          setIsVisible(false);
          setCurrentIndex(-1);
          if (onChange) onChange(-1);
          if (onComplete) onComplete();
        });
      } else {
        // Show/snap animation
        const targetTranslateY = getTranslateYForIndex(toIndex);

        if (!isVisible) {
          setIsVisible(true);
        }

        Animated.parallel([
          Animated.timing(translateY, {
            toValue: targetTranslateY,
            duration: 300,
            useNativeDriver: false, // Don't use native driver due to layout properties
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: Platform.OS !== 'web',
          }),
        ]).start(() => {
          setCurrentIndex(toIndex);
          if (onChange) onChange(toIndex);
          if (onComplete) onComplete();
        });
      }
    }, [currentIndex, snapPoints, translateY, backdropOpacity, onChange, onAnimate, getTranslateYForIndex, isVisible]);

    // Pan responder for drag gestures
    const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: (evt, gestureState) => {
          return Math.abs(gestureState.dy) > 10 && enablePanDownToClose;
        },
        onPanResponderGrant: () => {
          // Get current offset value
          const currentValue = (translateY as any)._value || 0;
          translateY.setOffset(currentValue);
          translateY.setValue(0);
        },
        onPanResponderMove: (evt, gestureState) => {
          if (gestureState.dy > 0) {
            // Only allow downward drags
            const resistance = overDragResistanceFactor || 2.5;
            const resistedValue = gestureState.dy / resistance;
            translateY.setValue(resistedValue);
          }
        },
        onPanResponderRelease: (evt, gestureState) => {
          translateY.flattenOffset();
          
          const currentHeight = getCurrentSnapHeight();
          const dragDistance = gestureState.dy;
          const dragVelocity = gestureState.vy;

          // Determine if we should dismiss or snap to a position
          if (dragDistance > currentHeight * 0.3 || dragVelocity > 0.5) {
            // Dismiss
            animateToPosition(-1);
          } else if (dragDistance < -50 && currentIndex < snapPoints.length - 1) {
            // Snap to higher position
            animateToPosition(currentIndex + 1);
          } else {
            // Snap back to current position
            animateToPosition(currentIndex);
          }
        },
      })
    ).current;

    // Imperative handle for ref methods
    useImperativeHandle(ref, () => ({
      present: () => {
        setIsVisible(true);
        setCurrentIndex(index);
        animateToPosition(index);
      },
      dismiss: () => {
        animateToPosition(-1);
      },
      expand: () => {
        if (currentIndex < snapPoints.length - 1) {
          animateToPosition(snapPoints.length - 1);
        }
      },
      collapse: () => {
        animateToPosition(0);
      },
      close: () => {
        animateToPosition(-1);
      },
      snapToIndex: (newIndex: number) => {
        if (newIndex >= 0 && newIndex < snapPoints.length) {
          animateToPosition(newIndex);
        }
      },
      snapToPosition: (position: string | number) => {
        const index = snapPoints.findIndex(sp => sp === position);
        if (index !== -1) {
          animateToPosition(index);
        }
      },
    }));

    // Handle backdrop press
    const handleBackdropPress = useCallback(() => {
      if (enablePanDownToClose) {
        animateToPosition(-1);
      }
    }, [enablePanDownToClose, animateToPosition]);

    // Default handle component
    const DefaultHandle = () => (
      <View style={styles.handleContainer}>
        <View style={[
          styles.handle, 
          handleIndicatorStyle,
          // Apply the same default styling as the original
          !handleIndicatorStyle?.backgroundColor && {
            backgroundColor: '#CCCCCC'
          }
        ]} />
      </View>
    );

    if (!isVisible) {
      return null;
    }

    return (
      <Modal
        visible={isVisible}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => animateToPosition(-1)}
      >
        {/* Backdrop */}
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: backdropOpacity,
            },
          ]}
        >
          {BackdropComponent ? (
            <BackdropComponent onPress={handleBackdropPress} />
          ) : (
            <View style={styles.defaultBackdrop} onTouchStart={handleBackdropPress} />
          )}
        </Animated.View>

        {/* Bottom Sheet Container */}
        <Animated.View
          style={[
            styles.container,
            {
              transform: [{ translateY }],
              height: SCREEN_HEIGHT, // Full height container
            },
          ]}
          {...(enableHandlePanningGesture ? panResponder.panHandlers : {})}
        >
          <View style={[styles.sheet, backgroundStyle]}>
            {/* Handle */}
            {HandleComponent ? <HandleComponent /> : <DefaultHandle />}
            
            {/* Content */}
            <View style={styles.content}>
              {children}
            </View>
          </View>
        </Animated.View>
      </Modal>
    );
  }
);

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  defaultBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'white',
    borderTopLeftRadius: 35, // Match the original styling
    borderTopRightRadius: 35,
    minHeight: 200,
    height: '100%', // Take full available height
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: {
          width: 0,
          height: -2,
        },
        shadowOpacity: 0.25,
        shadowRadius: 10,
      },
      android: {
        elevation: 10,
      },
      web: {
        boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.25)',
      },
    }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  handle: {
    width: 40,
    height: 4,
    backgroundColor: '#CCCCCC',
    borderRadius: 2,
    alignSelf: 'center',
  },
  content: {
    flex: 1,
  },
});

BottomSheetModal.displayName = 'BottomSheetModal';