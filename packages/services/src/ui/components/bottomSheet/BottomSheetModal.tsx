import React, { forwardRef, useImperativeHandle, useState, useRef, useCallback } from 'react';
import {
  View,
  Modal,
  Animated,
  Dimensions,
  PanResponder,
  StyleSheet,
  Platform,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Toaster } from '../../../lib/sonner';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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
  enableInternalToaster?: boolean;
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

const getSnapPointHeight = (snapPoint: string | number): number => {
  if (typeof snapPoint === 'string') {
    const percentage = Number.parseInt(snapPoint.replace('%', ''), 10);
    // Clamp percentage to valid range (0-100%)
    const clampedPercentage = Math.min(Math.max(percentage, 0), 100);
    return (SCREEN_HEIGHT * clampedPercentage) / 100;
  }
  // For fixed heights, clamp to screen height with some padding for safe area
  const maxHeight = SCREEN_HEIGHT - 50; // Reserve 50px for safe area/status bar
  return Math.min(Math.max(snapPoint, 100), maxHeight);
};

export const BottomSheetModal = forwardRef<BottomSheetModalRef, BottomSheetModalProps>(
  ({
    children,
    snapPoints = [],
    index = 0,
    enablePanDownToClose = true,
    backdropComponent: BackdropComponent,
    handleComponent: HandleComponent,
    backgroundStyle,
    handleIndicatorStyle,
    onChange,
    onAnimate,
    enableContentPanningGesture = true,
    enableHandlePanningGesture = true,
    overDragResistanceFactor = 2.5,
    enableInternalToaster = false,
  }, ref) => {
    const [isVisible, setIsVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(index);
    const translateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    const getCurrentSnapHeight = useCallback(() => {
      if (currentIndex >= 0 && currentIndex < snapPoints.length) {
        return getSnapPointHeight(snapPoints[currentIndex]);
      }
      // Fallback to first snap point if index is invalid
      if (snapPoints.length > 0) {
        return getSnapPointHeight(snapPoints[0]);
      }
      // Ultimate fallback
      return 200;
    }, [currentIndex, snapPoints]);

    const getTranslateYForIndex = useCallback((targetIndex: number) => {
      const targetHeight = getSnapPointHeight(snapPoints[targetIndex]);
      const translateY = SCREEN_HEIGHT - targetHeight;
      // Ensure translateY is never negative (which would put sheet off-screen)
      // and never exceeds SCREEN_HEIGHT (which would hide the sheet completely)
      return Math.max(Math.min(translateY, SCREEN_HEIGHT), 0);
    }, [snapPoints]);

    const animateToPosition = useCallback((toIndex: number, onComplete?: () => void) => {
      const fromIndex = currentIndex;
      
      onAnimate?.(fromIndex, toIndex);

      const duration = 300;
      const animationConfig = {
        duration,
        useNativeDriver: Platform.OS !== 'web',
      };

      if (toIndex === -1) {
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: SCREEN_HEIGHT,
            ...animationConfig,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 0,
            ...animationConfig,
          }),
        ]).start(() => {
          setIsVisible(false);
          setCurrentIndex(-1);
          onChange?.(-1);
          onComplete?.();
        });
      } else {
        const targetTranslateY = getTranslateYForIndex(toIndex);

        if (!isVisible) {
          setIsVisible(true);
        }

        Animated.parallel([
          Animated.timing(translateY, {
            toValue: targetTranslateY,
            ...animationConfig,
          }),
          Animated.timing(backdropOpacity, {
            toValue: 1,
            ...animationConfig,
          }),
        ]).start(() => {
          setCurrentIndex(toIndex);
          onChange?.(toIndex);
          onComplete?.();
        });
      }
    }, [currentIndex, translateY, backdropOpacity, onChange, onAnimate, getTranslateYForIndex, isVisible]);

    const panResponder = useRef(
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 5 && (enablePanDownToClose || enableHandlePanningGesture);
        },
        onPanResponderGrant: () => {
          const currentValue = (translateY as any)._value || 0;
          translateY.setOffset(currentValue);
          translateY.setValue(0);
        },
        onPanResponderMove: (_, gestureState) => {
          const resistance = overDragResistanceFactor;
          const currentTranslateY = (translateY as any)._value || 0;
          const currentOffset = (translateY as any)._offset || 0;
          const totalTranslateY = currentTranslateY + currentOffset;
          
          if (gestureState.dy > 0) {
            // Downward movement - allow but with resistance and bounds
            const resistedValue = gestureState.dy / resistance;
            const newValue = Math.min(resistedValue, SCREEN_HEIGHT - totalTranslateY);
            translateY.setValue(newValue);
          } else if (gestureState.dy < 0 && currentIndex < snapPoints.length - 1) {
            // Upward movement - allow but with resistance and bounds
            const resistedValue = gestureState.dy / (resistance * 0.5);
            // Prevent going above screen bounds
            const newValue = Math.max(resistedValue, -totalTranslateY);
            translateY.setValue(newValue);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          translateY.flattenOffset();
          
          const currentHeight = getCurrentSnapHeight();
          const { dy: dragDistance, vy: dragVelocity } = gestureState;

          // Improved gesture detection with better thresholds
          const dragThreshold = Math.min(currentHeight * 0.2, 50); // Adaptive threshold
          const velocityThreshold = 0.3;

          if (dragDistance > dragThreshold || dragVelocity > velocityThreshold) {
            if (currentIndex === 0 || dragDistance > currentHeight * 0.25) {
              animateToPosition(-1);
            } else {
              animateToPosition(currentIndex - 1);
            }
          } else if (dragDistance < -dragThreshold || dragVelocity < -velocityThreshold) {
            if (currentIndex < snapPoints.length - 1) {
              animateToPosition(currentIndex + 1);
            }
          } else {
            animateToPosition(currentIndex);
          }
        },
      })
    ).current;

    const handleBackdropPress = useCallback(() => {
      if (enablePanDownToClose) {
        animateToPosition(-1);
      }
    }, [enablePanDownToClose, animateToPosition]);

    const DefaultHandle = useCallback(() => (
      <View 
        style={styles.handleContainer}
        {...(enableHandlePanningGesture ? panResponder.panHandlers : {})}
      >
        <View style={[
          styles.handle, 
          handleIndicatorStyle,
          !handleIndicatorStyle?.backgroundColor && {
            backgroundColor: '#CCCCCC'
          }
        ]} />
      </View>
    ), [enableHandlePanningGesture, panResponder.panHandlers, handleIndicatorStyle]);

    useImperativeHandle(ref, () => ({
      present: () => {
        setIsVisible(true);
        setCurrentIndex(index);
        animateToPosition(index);
      },
      dismiss: () => animateToPosition(-1),
      expand: () => {
        if (currentIndex < snapPoints.length - 1) {
          animateToPosition(snapPoints.length - 1);
        }
      },
      collapse: () => animateToPosition(0),
      close: () => animateToPosition(-1),
      snapToIndex: (newIndex: number) => {
        // Ensure index is within valid bounds
        const clampedIndex = Math.max(0, Math.min(newIndex, snapPoints.length - 1));
        if (clampedIndex >= 0 && clampedIndex < snapPoints.length) {
          animateToPosition(clampedIndex);
        }
      },
      snapToPosition: (position: string | number) => {
        const targetIndex = snapPoints.findIndex(sp => sp === position);
        if (targetIndex !== -1) {
          animateToPosition(targetIndex);
        }
      },
    }), [index, currentIndex, snapPoints, animateToPosition]);

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
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: backdropOpacity },
          ]}
        >
          {BackdropComponent ? (
            <BackdropComponent onPress={handleBackdropPress} />
          ) : (
            <View style={styles.defaultBackdrop} onTouchStart={handleBackdropPress} />
          )}
        </Animated.View>

        <Animated.View
          style={[
            styles.container,
            {
              transform: [{ translateY }],
              // Ensure the container doesn't exceed screen bounds
              height: SCREEN_HEIGHT,
              // Add a minimum height to prevent completely hiding the sheet
              minHeight: 100,
            },
          ]}
        >
          <View 
            style={[
              styles.sheet, 
              backgroundStyle,
              {
                // Calculate height based on current snap point to prevent overflow
                height: Math.min(getCurrentSnapHeight(), SCREEN_HEIGHT - 50),
                maxHeight: SCREEN_HEIGHT - 50, // Reserve space for safe area
                minHeight: 100,
              }
            ]}
            {...(enableContentPanningGesture ? panResponder.panHandlers : {})}
          >
            {HandleComponent ? <HandleComponent /> : <DefaultHandle />}
            
            <ScrollView 
              style={styles.content}
              contentContainerStyle={{ 
                flexGrow: 1,
                // Reserve space for handle and padding, but ensure content doesn't overflow
                maxHeight: Math.max(getCurrentSnapHeight() - 60, SCREEN_HEIGHT - 160),
              }}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </ScrollView>
          </View>
        </Animated.View>

        {enableInternalToaster && (
          <View style={styles.toasterContainer}>
            <Toaster position="top-center" swipeToDismissDirection="left" offset={15} />
          </View>
        )}
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
    alignItems: 'center',
    justifyContent: 'flex-end',
    maxWidth: 800,
    marginHorizontal: 'auto',
  },
  sheet: {
    backgroundColor: 'white',
    borderTopLeftRadius: 35,
    borderTopRightRadius: 35,
    minHeight: 100,
    width: '100%',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.25,
        shadowRadius: 10,
      },
      android: {
        elevation: 10,
      },
      web: {
        boxShadow: '0 -2px 10px rgba(0, 0, 0, 0.25)',
        marginLeft: 'auto',
        marginRight: 'auto',
      },
    }),
  },
  handleContainer: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    minHeight: 40,
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
  toasterContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10000,
    elevation: 10000,
    pointerEvents: 'box-none',
  },
});

BottomSheetModal.displayName = 'BottomSheetModal';