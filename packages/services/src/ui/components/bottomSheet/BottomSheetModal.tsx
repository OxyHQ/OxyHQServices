import React, { forwardRef, useImperativeHandle, useState, useRef, useCallback } from 'react';
import {
  View,
  Modal,
  Animated,
  PanResponder,
  useWindowDimensions,
  StyleSheet,
  Platform,
} from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Toaster } from '../../../lib/sonner';

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
  adjustToContentHeightUpToSnapPoint?: boolean; // New prop
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

// This old function is no longer used by BottomSheetModal component and will be removed.
// const getSnapPointHeight (old one using SCREEN_HEIGHT) ...

const MIN_SHEET_HEIGHT = 100; // A general minimum height for the sheet
const HANDLE_HEIGHT_ESTIMATE = 50; // Estimated height of the handle area (padding + handle itself)

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
    adjustToContentHeightUpToSnapPoint = false, // Initialize new prop
  }, ref) => {
  const { height: screenHeight } = useWindowDimensions();
    const [isVisible, setIsVisible] = useState(false);
    const [currentIndex, setCurrentIndex] = useState(index);
    const [measuredContentHeight, setMeasuredContentHeight] = useState<number | null>(null);
    const [isPanning, setIsPanning] = useState(false); // New state for gesture tracking
  // Initialize translateY with the initial screen height. It will adapt if sheet is presented after a screen size change.
  const translateY = useRef(new Animated.Value(screenHeight)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

  // Renamed to avoid confusion, this calculates height based *only* on a snap point value
  const calculateHeightForSnapPointValue = useCallback((snapPointValue: string | number): number => {
    if (typeof snapPointValue === 'string') {
      const percentage = Number.parseInt(snapPointValue.replace('%', ''), 10);
      const clampedPercentage = Math.min(Math.max(percentage, 0), 100);
      return (screenHeight * clampedPercentage) / 100;
    }
    // For fixed heights, clamp to screen height with some padding for safe area
    const maxHeightForFixed = screenHeight - 50; 
    return Math.min(Math.max(snapPointValue, MIN_SHEET_HEIGHT), maxHeightForFixed);
  }, [screenHeight]);

  // This function now determines the actual target height for the sheet,
  // considering snap points and potentially content height.
  const getTargetSheetHeight = useCallback((snapPointIndexToCalculateFor: number): number => {
    if (snapPointIndexToCalculateFor < 0 || snapPointIndexToCalculateFor >= snapPoints.length) {
      // This case should ideally not be reached if for closing/dismiss, 
      // as height isn't relevant for translateY calculation there.
      // If snapPoints is empty, this could be an issue.
      if (snapPoints.length === 0 && adjustToContentHeightUpToSnapPoint && measuredContentHeight !== null) {
         const contentPlusHandle = measuredContentHeight + HANDLE_HEIGHT_ESTIMATE;
         return Math.min(Math.max(MIN_SHEET_HEIGHT, contentPlusHandle), screenHeight - 50);
      }
      return snapPoints.length > 0 ? calculateHeightForSnapPointValue(snapPoints[0]) : MIN_SHEET_HEIGHT * 2; // Fallback for empty snapPoints
    }

    const snapHeight = calculateHeightForSnapPointValue(snapPoints[snapPointIndexToCalculateFor]);

    if (adjustToContentHeightUpToSnapPoint && measuredContentHeight !== null) {
      const contentPlusHandle = measuredContentHeight + HANDLE_HEIGHT_ESTIMATE;
      // Ensure sheet is at least MIN_SHEET_HEIGHT, and content-driven height doesn't exceed current snap point height.
      return Math.min(snapHeight, Math.max(MIN_SHEET_HEIGHT, contentPlusHandle));
    }
    return snapHeight;
  }, [
    snapPoints, 
    adjustToContentHeightUpToSnapPoint, 
    measuredContentHeight, 
    calculateHeightForSnapPointValue, 
    screenHeight // Added screenHeight as calculateHeightForSnapPointValue might not be enough if snapPoints is empty
  ]);

    // This is now used to get the height for styling the sheet view directly
    const currentSheetHeightForStyle = useCallback(() => {
        return getTargetSheetHeight(currentIndex);
    }, [currentIndex, getTargetSheetHeight]);

    const getTranslateYForIndex = useCallback((targetIndex: number) => {
      // If closing (toIndex == -1), target height for Y translation is effectively 0, leading to translateY = screenHeight.
      // For actual snap points, calculate target height.
      const targetSheetActualHeight = targetIndex === -1 ? 0 : getTargetSheetHeight(targetIndex);
      // Corrected: use targetSheetActualHeight instead of undefined targetHeight
      const calculatedTranslateY = screenHeight - targetSheetActualHeight; 
      return Math.max(Math.min(calculatedTranslateY, screenHeight), 0);
      // Corrected: remove snapPoints and getSnapPointHeight, use getTargetSheetHeight
  }, [getTargetSheetHeight, screenHeight]); 

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
            toValue: screenHeight, // Use dynamic screenHeight
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
          // Activate if vertical drag is more than 5 pixels.
          // The PanResponder is attached conditionally (handle or content),
          // so if this function is called, it means the interaction is on an enabled area.
          return Math.abs(gestureState.dy) > 5;
        },
        onPanResponderGrant: () => {
          setIsPanning(true);
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
            // Ensure sheet cannot be dragged below the bottom of the screen
            const maxTranslateValue = screenHeight - totalTranslateY;
            const newValue = Math.min(resistedValue, maxTranslateValue);
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
          setIsPanning(false);
          
          // Corrected: use getTargetSheetHeight(currentIndex) for current sheet's actual height
          const currentActualSheetHeight = getTargetSheetHeight(currentIndex); 
          const { dy: dragDistance, vy: dragVelocity } = gestureState;

          // Improved gesture detection with better thresholds
          const dragThreshold = Math.min(currentActualSheetHeight * 0.2, 50); // Adaptive threshold
          const velocityThreshold = 0.3;

          if (dragDistance > dragThreshold || dragVelocity > velocityThreshold) { // Downward gesture
            if (enablePanDownToClose && (currentIndex === 0 || dragDistance > currentActualSheetHeight * 0.25)) {
              animateToPosition(-1); // Close sheet
            } else if (currentIndex > 0) { 
              // If not closing (either disabled or conditions not met for close)
              // and not already at the lowest snap point (index 0)
              animateToPosition(currentIndex - 1); // Snap to lower snap point
            } else {
              // If already at index 0 and not closing, or if conditions for lower snap not met
              animateToPosition(currentIndex); // Snap back to current position (index 0)
            }
          } else if (dragDistance < -dragThreshold || dragVelocity < -velocityThreshold) { // Upward gesture
            if (currentIndex < snapPoints.length - 1) {
              animateToPosition(currentIndex + 1); // Snap to higher snap point
            } else {
              // Already at the highest snap point, snap back to it
              animateToPosition(currentIndex);
            }
          } else {
            // No significant drag/velocity, snap back to current position
            animateToPosition(currentIndex);
          }
        },
        onPanResponderTerminate: () => { // Handle gesture termination
          setIsPanning(false);
          // Optionally, decide if you want to snap back or to a specific position on terminate
          // For now, flattenOffset similar to release might be safest if mid-gesture
          translateY.flattenOffset(); 
          // And then snap to current index, or perhaps a more sophisticated logic based on current position
          animateToPosition(currentIndex); 
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
        translateY.setValue(screenHeight); 
        setIsVisible(true);
        setMeasuredContentHeight(null); // Reset on present for fresh measurement
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
    }), [index, currentIndex, snapPoints, animateToPosition, screenHeight]);

    // Effect to re-animate if content height changes and sheet is set to adjust
    useEffect(() => {
      if (isVisible && adjustToContentHeightUpToSnapPoint && measuredContentHeight !== null) {
        if (!isPanning) { // Use the new isPanning state
          // Check if the current visual height (derived from translateY) matches the target height.
          // This prevents redundant animations if the height is already correct.
          // Note: Reading _value and _offset directly from Animated.Value for logic is generally discouraged
          // outside gesture contexts as it breaks the declarative model.
          // However, for this specific check to prevent redundant animations, it's a pragmatic approach.
          const currentVisualTranslateY = (translateY as any)._value + ((translateY as any)._offset || 0) ;
          const currentVisualHeight = screenHeight - currentVisualTranslateY;
          const targetSheetHeight = getTargetSheetHeight(currentIndex);
          
          if (Math.abs(currentVisualHeight - targetSheetHeight) > 1) { // Threshold to avoid tiny adjustments
            animateToPosition(currentIndex);
          }
        }
      }
      // Intentionally not including animateToPosition in deps to avoid loops if it's not perfectly stable,
      // relying on currentIndex, isVisible, and measuredContentHeight as triggers.
      // getTargetSheetHeight is also a dependency as it changes with measuredContentHeight.
    }, [measuredContentHeight, adjustToContentHeightUpToSnapPoint, isVisible, currentIndex, screenHeight, getTargetSheetHeight, translateY]);


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
              height: screenHeight, // Use dynamic screenHeight
              minHeight: 100, // Keep a minimum height
            },
          ]}
        >
          <View 
            style={[
              styles.sheet, 
              backgroundStyle,
              {
                // Use currentSheetHeightForStyle for the dynamic height
                height: Math.min(currentSheetHeightForStyle(), screenHeight - 50), 
                maxHeight: screenHeight - 50, 
                minHeight: MIN_SHEET_HEIGHT, // Use constant
              }
            ]}
            {...(enableContentPanningGesture ? panResponder.panHandlers : {})}
          >
            {HandleComponent ? <HandleComponent /> : <DefaultHandle />}
            
            <ScrollView 
              style={styles.content}
              // Note on ScrollView vs. PanResponder conflict:
              // If enableContentPanningGesture is true, the sheet's PanResponder is on a parent of this ScrollView.
              // Standard React Native responder system rules apply. A vertical gesture might be claimed by
              // either the ScrollView or the PanResponder, potentially leading to the sheet dragging when
              // the user intends to scroll content, or vice-versa.
              // Using react-native-gesture-handler's PanGestureHandler for the sheet itself would offer
              // more advanced coordination capabilities (e.g., simultaneousHandlers, waitFor) to mitigate this.
              contentContainerStyle={{ 
                flexGrow: 1,
              }}
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View onLayout={(event) => {
                if (isPanning) {
                  // Ignore layout changes while actively dragging to prevent
                  // jitter from rapid height recalculations
                  return;
                }

                const height = event.nativeEvent.layout.height;
                // Update only if height has meaningfully changed to avoid rapid state updates.
                // Using a small threshold like 1px.
                if (measuredContentHeight === null || Math.abs(measuredContentHeight - height) > 1) {
                     setMeasuredContentHeight(height);
                }
              }}>
                {children}
              </View>
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
    minHeight: MIN_SHEET_HEIGHT, // Use constant
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
    minHeight: HANDLE_HEIGHT_ESTIMATE, // Use constant
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